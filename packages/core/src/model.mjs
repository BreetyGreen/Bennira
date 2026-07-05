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
// 每项：{ id, label, baseURL, model, hint, models }。custom 的 baseURL/model 为空，
// 表示"由用户手填"。顺序即菜单顺序，DeepSeek 放第一（用户当前就用它）。
//
// models —— 「内置模型目录」（策略一）。这是对齐 openclaw「初始化就能选」体验的关键：
//   一份编译进工具的静态精选清单，不依赖 key、不联网，选完服务商立刻能弹菜单挑。
//   它回答「这个工具支持接哪些模型」；填了 key 后再用 listModels 实时拉取叠加校准
//   （策略二，回答「你的 key 有权访问哪些」）。两者由 mergeModelLists 合并去重。
//   model（默认款）应出现在 models 里并作为菜单默认高亮。custom 无目录，仍走手填。
export const PROVIDER_PRESETS = Object.freeze([
  {
    id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com",
    model: "deepseek-chat", hint: "深度求索 · 高性价比",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini", hint: "GPT 系列",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o3-mini", "o1-mini"],
  },
  {
    id: "kimi", label: "Kimi / 月之暗面", baseURL: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k", hint: "长上下文见长",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-k2-0711-preview"],
  },
  {
    id: "qwen", label: "通义千问 Qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus", hint: "阿里云 · 兼容模式",
    models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen2.5-72b-instruct", "qwen2.5-coder-32b-instruct"],
  },
  {
    id: "zhipu", label: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4", hint: "GLM 系列",
    models: ["glm-4", "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4-long"],
  },
  {
    id: "ollama", label: "本地 Ollama", baseURL: "http://localhost:11434/v1",
    model: "llama3", hint: "本地运行 · 免 key",
    models: ["llama3", "llama3.1", "qwen2.5", "qwen2.5-coder", "gemma2", "mistral", "phi3"],
  },
  {
    id: "custom", label: "自定义…", baseURL: "", model: "", hint: "手填 baseURL 与模型名",
    models: [],
  },
]);

// 按 id 取预设；找不到返回 undefined（调用方兜底为 custom）。
export function findProviderPreset(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

// 取某服务商的内置模型目录（策略一）。找不到 / custom 返回空数组。
// 调用方（setup）据此在「未填 key」时就能给出可选菜单。
export function builtinModels(providerId) {
  const preset = findProviderPreset(providerId);
  return preset && Array.isArray(preset.models) ? [...preset.models] : [];
}

// 合并「内置目录」与「实时拉取」两份清单（策略一 + 策略二叠加）。
// -----------------------------------------------------------------------------
// 规则：内置目录在前（精选、稳定、顺序有意义），实时拉取里的新模型按字母序补在后面。
// 去重（内置已有的实时结果不重复）。任一为空都能正确退化为另一份。
export function mergeModelLists(builtin, fetched) {
  const head = Array.isArray(builtin) ? builtin.filter((s) => typeof s === "string" && s) : [];
  const tail = Array.isArray(fetched) ? fetched.filter((s) => typeof s === "string" && s) : [];
  const seen = new Set(head);
  const extras = [...new Set(tail)].filter((id) => !seen.has(id)).sort((a, b) => a.localeCompare(b));
  return [...head, ...extras];
}

// 把 baseURL 归一成 {baseURL}/v1/models 端点。与 provider.endpoint() 同源逻辑：
// 用户可能填到 /v1、裸域名或已带 /models，三种都拼对。
function modelsEndpoint(baseURL) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  if (/\/models$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

// 拉取服务商的模型列表（OpenAI 兼容 GET {baseURL}/v1/models）。
// -----------------------------------------------------------------------------
// 这是 setup 里「选模型」体验的来源：填完 key 后调它，把 data[].id 做成菜单。
// 关键前提——除本地 Ollama 外，这个接口都要求带 key 才有权限。所以调用方必须
// 保证「先填 key、再拉列表」的顺序（key 在手才拉得到），否则会 401。
//
// 失败策略：不抛崩溃，返回 { ok, models, error }。上层据此决定「用列表选」还是
// 「降级回手填」——网络不通 / 无 key / 老服务不支持 /models，都要能优雅兜底。
export async function listModels(baseURL, apiKey, { signal, timeoutMs = 8000 } = {}) {
  if (!baseURL) return { ok: false, models: [], error: "缺少 baseURL" };
  const endpoint = modelsEndpoint(baseURL);
  const link = linkAbort(signal, timeoutMs);
  let response;
  try {
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    response = await fetch(endpoint, { method: "GET", headers, signal: link.signal });
  } catch (error) {
    if (link.signal.aborted) {
      const reason = classifyAbort(link.signal.reason, timeoutMs);
      return { ok: false, models: [], error: reason.message, aborted: reason instanceof UserAbortError };
    }
    return { ok: false, models: [], error: `无法连接：${error?.message || error}` };
  } finally {
    link.cleanup();
  }

  if (!response.ok) {
    const body = await safeText(response);
    return { ok: false, models: [], error: `服务返回 ${response.status}：${body.slice(0, 160)}`, status: response.status };
  }

  const data = await response.json().catch(() => null);
  // 兼容两种形态：OpenAI 的 { data:[{id}] }，与个别服务直接返回 { models:[...] } 或数组。
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];
  const models = rawList
    .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
    .filter((id) => typeof id === "string" && id.length > 0);
  // 去重 + 稳定排序（字母序，便于在菜单里找）。
  const unique = [...new Set(models)].sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) {
    return { ok: false, models: [], error: "服务未返回任何模型" };
  }
  return { ok: true, models: unique };
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

  // 带工具的非流式生成（原生 function-calling 路径）。
  // ---------------------------------------------------------------------------
  // 与 generate 的关键区别：请求体多带 tools:[...]，让端点返回结构化的
  // message.tool_calls，而不是一段要我们正则解析的文本。
  //
  // 返回形状是 **对象** { text, toolCalls, finishReason }，而不是 generate 的
  // 裸 string——因为调用方（agent loop）既要拿工具调用，也可能拿纯文本收尾。
  //   - toolCalls：数组，端点直接给的结构化调用（可能为空）。
  //   - text：message.content（模型的自然语言，可能与 tool_calls 并存或独存）。
  //   - finishReason：choices[0].finish_reason，"tool_calls" 时表示模型要调工具。
  //
  // 不支持 tools 的服务（本地 Ollama / 部分 custom）：多数会忽略 tools 参数、
  // 照常只回 content——此时 toolCalls 为空，上层据此回退到 parseAgentAction。
  // 少数会直接 4xx 报错——由上层 catch 后同样回退。所以这条路对旧 provider 是
  // 「优先尝试、失败即退」，不破坏可用性。
  async generateWithTools(messages, tools, { signal: externalSignal, toolChoice = "auto" } = {}) {
    const link = linkAbort(externalSignal, this.timeoutMs);
    let response;
    try {
      const body = {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      };
      // 只在真有工具时才带 tools/tool_choice——空数组会被某些端点判为非法。
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = toolChoice;
      }
      response = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: link.signal,
      });
    } catch (error) {
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
    const message = data?.choices?.[0]?.message || {};
    const finishReason = data?.choices?.[0]?.finish_reason;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const text = typeof message.content === "string" ? message.content : "";
    // 既无工具调用、又无文本——才算真正的空响应（异常）。
    if (toolCalls.length === 0 && !text.trim()) {
      throw new ModelRequestError("模型返回内容为空或格式异常。");
    }
    return { text: text.trim(), toolCalls, finishReason, raw: message };
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
