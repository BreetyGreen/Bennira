import { resolveModelCredentials } from "./secrets.mjs";

// model.mjs —— ModelProvider 抽象层
// -----------------------------------------------------------------------------
// 设计目标：
//   1. 零依赖：用原生 fetch 直连，不引 openai SDK。
//   2. 可替换：上层只依赖 provider.generate(messages) → text。
//      今天接 OpenAI 兼容协议，明天接 Ollama 只是加一个 provider，上层不动。
//   3. 尊重权限门：调模型 = 联网。network=deny 时抛可识别的 NetworkDeniedError，
//      由上层决定是否降级，而不是偷偷联网（盗贼谨慎人设）。

export class NetworkDeniedError extends Error {
  constructor(message = "网络权限为 deny，已阻止联网调用模型。") {
    super(message);
    this.name = "NetworkDeniedError";
    this.code = "NETWORK_DENIED";
  }
}

export class ModelConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelConfigError";
    this.code = "MODEL_CONFIG";
  }
}

export class ModelRequestError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "ModelRequestError";
    this.code = "MODEL_REQUEST";
    this.status = status;
  }
}

// OpenAI 兼容 Provider：POST {baseURL}/chat/completions
class OpenAICompatibleProvider {
  constructor({ baseURL, model, apiKey, temperature, maxTokens, timeoutMs }) {
    this.baseURL = String(baseURL || "").replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.temperature = temperature ?? 0.3;
    this.maxTokens = maxTokens ?? 1200;
    this.timeoutMs = timeoutMs ?? 60000;
  }

  endpoint() {
    // 允许用户填到 /v1 或裸域名，两种都拼对。
    if (/\/chat\/completions$/.test(this.baseURL)) {
      return this.baseURL;
    }
    if (/\/v1$/.test(this.baseURL)) {
      return `${this.baseURL}/chat/completions`;
    }
    return `${this.baseURL}/v1/chat/completions`;
  }

  async generate(messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ModelRequestError(`模型请求超时（${this.timeoutMs}ms）。`);
      }
      throw new ModelRequestError(`无法连接模型服务：${error?.message || error}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new ModelRequestError(
        `模型返回 ${response.status}：${body.slice(0, 300)}`,
        { status: response.status }
      );
    }

    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new ModelRequestError("模型返回内容为空或格式异常。");
    }
    return text.trim();
  }

  // 流式生成：走 OpenAI 兼容 SSE（stream:true），逐 token 回调 onToken(delta)。
  // 返回拼接后的完整文本。onToken 只在拿到内容增量时触发——上层据此实现
  // "首个 token 到达即停 spinner、逐字打印"的活感。
  //
  // 超时语义与非流式不同：timeoutMs 在这里是"首字节前"的连接超时；一旦开始
  // 出字就认为链路健康，不再用整体超时掐断（避免长回答被误杀）。
  async generateStream(messages, onToken = () => {}) {
    const controller = new AbortController();
    let firstByteTimer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(firstByteTimer);
      if (error?.name === "AbortError") {
        throw new ModelRequestError(`模型请求超时（${this.timeoutMs}ms）。`);
      }
      throw new ModelRequestError(`无法连接模型服务：${error?.message || error}`);
    }

    if (!response.ok) {
      clearTimeout(firstByteTimer);
      const body = await safeText(response);
      throw new ModelRequestError(
        `模型返回 ${response.status}：${body.slice(0, 300)}`,
        { status: response.status }
      );
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      // 环境不支持流式 body（极旧 runtime）——回退到非流式，一次性回调。
      clearTimeout(firstByteTimer);
      const text = await this.generate(messages);
      onToken(text);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let firstTokenSeen = false;

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (firstByteTimer) {
          // 收到首个字节，取消首字节超时。
          clearTimeout(firstByteTimer);
          firstByteTimer = null;
        }
        buffer += decoder.decode(value, { stream: true });

        // SSE 以换行分隔；一行可能是 "data: {...}" 或 "data: [DONE]"。
        let nlIndex;
        while ((nlIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIndex).trim();
          buffer = buffer.slice(nlIndex + 1);
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 跨 chunk 截断的行，交给下一轮 buffer 拼接
          }
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            firstTokenSeen = true;
            full += delta;
            onToken(delta);
          }
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ModelRequestError(`模型请求超时（${this.timeoutMs}ms）。`);
      }
      throw new ModelRequestError(`流式读取中断：${error?.message || error}`);
    } finally {
      if (firstByteTimer) clearTimeout(firstByteTimer);
    }

    if (!full.trim() && !firstTokenSeen) {
      throw new ModelRequestError("模型返回内容为空或格式异常。");
    }
    return full.trim();
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

// 工厂：从 config + secrets + permissions 构建 provider。
// 出于安全，这里就把权限门和配置完整性检查做掉——拿到 provider 就一定能用。
export function createProvider(root, config) {
  const permissions = config.permissions || {};
  if (permissions.network === "deny") {
    throw new NetworkDeniedError();
  }

  const modelCfg = config.model || {};
  if (modelCfg.provider && modelCfg.provider !== "openai-compatible") {
    throw new ModelConfigError(`暂不支持的 provider：${modelCfg.provider}`);
  }
  if (!modelCfg.baseURL) {
    throw new ModelConfigError("未配置模型 baseURL，请先运行 `bennira setup`。");
  }
  if (!modelCfg.model) {
    throw new ModelConfigError("未配置模型名称，请先运行 `bennira setup`。");
  }

  const { apiKey } = resolveModelCredentials(root);
  if (!apiKey) {
    throw new ModelConfigError(
      "未找到 API key。请运行 `bennira setup` 填写，或设置环境变量 BENNIRA_API_KEY。"
    );
  }

  return new OpenAICompatibleProvider({
    baseURL: modelCfg.baseURL,
    model: modelCfg.model,
    apiKey,
    temperature: modelCfg.temperature,
    maxTokens: modelCfg.maxTokens,
    timeoutMs: modelCfg.timeoutMs,
  });
}

// 供上层区分"为什么不能用"，给出精准提示。
export function modelReadiness(root, config) {
  const permissions = config.permissions || {};
  const modelCfg = config.model || {};
  const { apiKey, source } = resolveModelCredentials(root);
  return {
    networkAllowed: permissions.network !== "deny",
    hasBaseURL: Boolean(modelCfg.baseURL),
    hasModel: Boolean(modelCfg.model),
    hasKey: Boolean(apiKey),
    keySource: source,
    ready:
      permissions.network !== "deny" &&
      Boolean(modelCfg.baseURL) &&
      Boolean(modelCfg.model) &&
      Boolean(apiKey),
  };
}
