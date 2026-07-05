// agent.mjs —— Agentic 循环协议（小偷不再只会看，也能动手）
// -----------------------------------------------------------------------------
// 版本线说明：从"小偷 Alpha（只读+计划）"升级为"小偷（agentic）"。
// "小偷"指我们大量借鉴前人（Codex / Claude Code）的交互范式，不是指不能改东西。
//
// 这一层只负责"协议与解析"，是纯逻辑、可离线单测：
//   1. AGENT_SYSTEM：告诉模型有哪些工具、必须用什么格式回话。
//   2. buildAgentMessages：把项目快照 + 对话历史组装成 messages。
//   3. parseAgentAction：把模型输出解析成 { thought, action, args }。
//
// 真正执行工具（读写文件 / 跑命令 / 确认交互）在 CLI 层做——core 不碰 fs/exec，
// 保持可测试、可移植。执行结果由 CLI 作为 role:"user" 的观察喂回，形成闭环。

// 工具清单（模型可调用的动作）。risk 决定 CLI 是否需要用户确认。
// -----------------------------------------------------------------------------
// params 是每个工具的入参 JSON Schema（OpenAI function-calling 用）。
// 它有两个用途：
//   1. 原生 tool_calls 路径（策略一）：编成 tools:[...] 随请求发出，端点据此
//      校验模型给的 args，结构化返回——不再靠我们正则去文本里捞 JSON。
//   2. 文本 JSON 路径（策略二/fallback）：desc 里仍保留人类可读的 args 说明，
//      不支持 tools 的 provider（本地 Ollama、部分 custom）照旧走 parseAgentAction。
// 两条路共用同一份 AGENT_TOOLS，语义单一来源，不会漂移。
export const AGENT_TOOLS = [
  {
    name: "read_file", risk: "safe", desc: "读取一个文件的内容。args: { path }",
    params: {
      type: "object",
      properties: { path: { type: "string", description: "相对项目根的文件路径" } },
      required: ["path"],
    },
  },
  {
    name: "list_files", risk: "safe", desc: "列出某目录下的文件。args: { path }（默认项目根）",
    params: {
      type: "object",
      properties: { path: { type: "string", description: "相对项目根的目录路径，缺省为项目根" } },
      required: [],
    },
  },
  {
    name: "search", risk: "safe", desc: "在项目内按关键字搜索文件内容。args: { query }",
    params: {
      type: "object",
      properties: { query: { type: "string", description: "要搜索的关键字" } },
      required: ["query"],
    },
  },
  {
    name: "write_file", risk: "danger", desc: "创建或覆盖一个文件。args: { path, content }",
    params: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对项目根的文件路径" },
        content: { type: "string", description: "文件的完整新内容（不是 diff）" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command", risk: "danger", desc: "在项目根执行一条 shell 命令。args: { command }",
    params: {
      type: "object",
      properties: { command: { type: "string", description: "要执行的 shell 命令" } },
      required: ["command"],
    },
  },
  {
    name: "finish", risk: "safe", desc: "结束本轮，向用户交付最终回答。args: { message }",
    params: {
      type: "object",
      properties: { message: { type: "string", description: "给用户看的中文最终回答" } },
      required: ["message"],
    },
  },
];

export const AGENT_TOOL_RISK = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t.risk])
);

// 把 AGENT_TOOLS 编成 OpenAI function-calling 的 tools:[...] 结构。
// -----------------------------------------------------------------------------
// 每项形如 { type:"function", function:{ name, description, parameters } }。
// 这是随 /chat/completions 请求发出的 tools 参数——端点据此让模型返回结构化的
// tool_calls，而不是我们再去正则解析文本。desc 直接当 description，params 当
// parameters（缺省给一个空对象 schema，保证永远是合法的 JSON Schema）。
export function toolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.desc,
      parameters: t.params || { type: "object", properties: {}, required: [] },
    },
  }));
}

// 把原生 tool_calls[0] 归一成与 parseAgentAction 相同形状的动作对象。
// -----------------------------------------------------------------------------
// 端点返回的 message.tool_calls[i] 形如：
//   { id, type:"function", function:{ name, arguments:"<JSON字符串>" } }
// 注意 arguments 是 **字符串**（即便内容是 JSON），所以要 JSON.parse。
// 解析失败时不吞掉——返回 args:{} 但带上 raw，让上层能察觉而不是静默兜底。
// 返回对象额外带 toolCallId：T3 的 role:"tool" 回喂需要它做配对。
export function actionFromToolCall(toolCall) {
  const fn = toolCall?.function || {};
  const name = typeof fn.name === "string" ? fn.name : "";
  let args = {};
  if (typeof fn.arguments === "string" && fn.arguments.trim()) {
    try {
      const parsed = JSON.parse(fn.arguments);
      if (parsed && typeof parsed === "object") args = parsed;
    } catch {
      // 结构化通道里 arguments 仍解析失败极罕见——不静默当 finish，
      // 保留空 args + raw，交由上层决定（通常回喂错误让模型重试）。
    }
  } else if (fn.arguments && typeof fn.arguments === "object") {
    // 个别实现直接给对象而非字符串——一并兼容。
    args = fn.arguments;
  }
  return {
    thought: "",
    action: name,
    args,
    toolCallId: typeof toolCall?.id === "string" ? toolCall.id : undefined,
    raw: toolCall,
  };
}

const TOOL_LINES = AGENT_TOOLS.map((t) => `- ${t.name}（${t.risk}）：${t.desc}`).join("\n");

export const AGENT_SYSTEM = `你是 Bennira——一个务实、谨慎、动手能力强的项目助手（人设：《八方旅人》盗贼）。
"小偷"意味着你善于借鉴前人的优秀范式，并能真正动手改造项目——不是只会旁观。

你在一个 ReAct 循环里工作：思考 → 选一个工具 → 观察结果 → 再思考，直到能给出最终答复。

【可用工具】
${TOOL_LINES}

【回话格式】每次只输出一个 JSON 对象，不要代码块包裹，不要任何额外文字：
{
  "thought": "你的简短推理（中文）",
  "action": "工具名",
  "args": { ... }
}

【规则】
- 一次只调用一个工具。想读文件就 read_file，想改就 write_file，想跑测试就 run_command。
- 需要更多信息时，先用 safe 工具（read_file / list_files / search）把情况搞清楚，再动手改。
- 修改文件用 write_file 时，content 要给出文件的完整新内容（不是 diff）。
- 完成任务或需要向用户交付结论时，用 action:"finish"，在 args.message 里写给用户看的中文回答。
- 危险动作（write_file / run_command）会经过用户确认，被拒绝时你会收到"用户拒绝"的观察，请据此调整。
- 务实：能一步到位就别啰嗦；拿不准就先看再动。`;

// 组装 agentic 对话的 messages。history 是历次 { role, content } 累积。
export function buildAgentMessages(snapshot, history) {
  const sys = `${AGENT_SYSTEM}\n\n【当前项目快照】\n${snapshot}`;
  return [{ role: "system", content: sys }, ...history];
}

// 解析模型输出为动作。容错：允许 ```json 包裹、允许前后杂字、允许纯文本兜底。
export function parseAgentAction(text) {
  const cleaned = stripCodeFence(String(text || "").trim());
  const obj = tryParseJson(cleaned) ?? tryParseJson(extractFirstJsonObject(cleaned));
  if (obj && typeof obj.action === "string") {
    return {
      thought: typeof obj.thought === "string" ? obj.thought : "",
      action: obj.action,
      args: obj.args && typeof obj.args === "object" ? obj.args : {},
      raw: text,
    };
  }
  // 兜底：模型没按格式输出——当作它想直接把这段话交付给用户（finish）。
  return {
    thought: "",
    action: "finish",
    args: { message: cleaned || String(text || "") },
    raw: text,
    fellBack: true,
  };
}

function tryParseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 从一段文本里抠出第一个平衡的 {...} 块（应对模型在 JSON 前后加了解释）。
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : trimmed;
}
