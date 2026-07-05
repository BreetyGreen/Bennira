import { resolveModelCredentials } from "./secrets.mjs";

// model.mjs —— ModelProvider 抽象层
// -----------------------------------------------------------------------------
// 设计目标：
//   1. 零依赖：用原生 fetch 直连，不引 openai SDK。
//   2. 可替换：上层只依赖 provider.generate(messages) → text。
//      今天接 OpenAI 兼容协议，明天接 Ollama 只是加一个 provider，上层不动。
//   3. 尊重权限门：调模型 = 联网。network=deny 时抛可识别的 NetworkDeniedError，
//      由上层决定是否降级，而不是偷偷联网（盗贼谨慎人设）。

// 服务商预设表 —— setup 里"选一家就好"的体验来源。
// -----------------------------------------------------------------------------
// 设计取舍：底层永远只认 baseURL + model（OpenAI 兼容协议，不绑定任何一家）。
// 但对 99% 只用某一家的人，让他背一串网址太反人类。所以这里内置常见服务商，
// 选中即自动带出 baseURL / 默认模型名，用户只剩"粘 key"一步。
// 想用冷门服务的人选 custom，回到手填 —— 灵活性一点不丢。
//
// 每项：{ id, label, baseURL, model, hint }。custom 的 baseURL/model 为空，
// 表示"由用户手填"。顺序即菜单顺序，DeepSeek 放第一（用户当前就用它）。
export const PROVIDER_PRESETS = Object.freeze([
  { id: "deepseek", label: "DeepSeek",        baseURL: "https://api.deepseek.com",   model: "deepseek-chat",  hint: "深度求索 · 高性价比" },
  { id: "openai",   label: "OpenAI",          baseURL: "https://api.openai.com/v1",  model: "gpt-4o-mini",    hint: "GPT 系列" },
  { id: "kimi",     label: "Kimi / 月之暗面",  baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", hint: "长上下文见长" },
  { id: "qwen",     label: "通义千问 Qwen",    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", hint: "阿里云 · 兼容模式" },
  { id: "zhipu",    label: "智谱 GLM",         baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4",  hint: "GLM 系列" },
  { id: "ollama",   label: "本地 Ollama",      baseURL: "http://localhost:11434/v1",  model: "llama3",         hint: "本地运行 · 免 key" },
  { id: "custom",   label: "自定义…",          baseURL: "",                           model: "",               hint: "手填 baseURL 与模型名" },
]);

// 按 id 取预设；找不到返回 undefined（调用方兜底为 custom）。
export function findProviderPreset(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

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

// 用户主动中断（Ctrl+C）。与"超时"区分：超时是链路故障，中断是用户意愿。
// 上层据此决定文案——超时提示重试，中断则安静回到提示符（抄 Codex / Claude Code）。
export class UserAbortError extends Error {
  constructor(message = "已中断本次生成。") {
    super(message);
    this.name = "UserAbortError";
    this.code = "USER_ABORT";
  }
}

// 把"外部中断 signal"与"内部超时 controller"合流：任一触发都 abort 请求。
// 返回 { signal, cleanup }——signal 传给 fetch，cleanup 负责摘监听、清定时器。
// external 为 undefined 时退化为"只有超时"，行为与旧代码一致。
function linkAbort(external, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(new ModelRequestError(`模型请求超时（${timeoutMs}ms）。`)), timeoutMs);
  }
  const onExternalAbort = () => controller.abort(new UserAbortError());
  if (external) {
    if (external.aborted) controller.abort(new UserAbortError());
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    // 清除首字节超时（流式收到首字节后调用）：只停超时，保留外部中断能力。
    clearTimeoutOnly() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    cleanup() {
      if (timer) clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    },
  };
}

// 把 abort 原因归一成我们的错误类型：外部中断 → UserAbortError，其余 → 超时。
function classifyAbort(controllerReason, fallbackTimeoutMs) {
  if (controllerReason instanceof UserAbortError) return controllerReason;
  if (controllerReason instanceof ModelRequestError) return controllerReason;
  return new ModelRequestError(`模型请求超时（${fallbackTimeoutMs}ms）。`);
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

  async generate(messages, { signal: externalSignal } = {}) {
    const link = linkAbort(externalSignal, this.timeoutMs);
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
        signal: link.signal,
      });
    } catch (error) {
      // 注意：controller.abort(reason) 带 reason 时，fetch reject 出来的就是
      // 那个 reason 本身（name 不一定是 "AbortError"）。所以不靠 error.name 猜，
      // 直接看 signal.aborted —— 只要被中断就按中断/超时归类，更健壮。
      if (link.signal.aborted) {
        throw classifyAbort(link.signal.reason, this.timeoutMs);
      }
      throw new ModelRequestError(`无法连接模型服务：${error?.message || error}`);
    } finally {
      link.cleanup();
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
  async generateStream(messages, onToken = () => {}, { signal: externalSignal } = {}) {
    const link = linkAbort(externalSignal, this.timeoutMs);
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
        signal: link.signal,
      });
    } catch (error) {
      link.cleanup();
      if (link.signal.aborted) {
        throw classifyAbort(link.signal.reason, this.timeoutMs);
      }
      throw new ModelRequestError(`无法连接模型服务：${error?.message || error}`);
    }

    if (!response.ok) {
      link.cleanup();
      const body = await safeText(response);
      throw new ModelRequestError(
        `模型返回 ${response.status}：${body.slice(0, 300)}`,
        { status: response.status }
      );
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      // 环境不支持流式 body（极旧 runtime）——回退到非流式，一次性回调。
      link.cleanup();
      const text = await this.generate(messages, { signal: externalSignal });
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
        // 收到首个字节，取消"首字节前"超时（但保留外部中断能力）。
        link.clearTimeoutOnly();
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
      if (link.signal.aborted) {
        throw classifyAbort(link.signal.reason, this.timeoutMs);
      }
      throw new ModelRequestError(`流式读取中断：${error?.message || error}`);
    } finally {
      link.cleanup();
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
