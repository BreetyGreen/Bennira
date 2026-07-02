// context.mjs —— Context 组装层（context engineering）
// -----------------------------------------------------------------------------
// 这是 Bennira 的"眼睛"和"大脑"之间的那根管子。
// 职责：把 inspect（机械观察）的结果，挑选、裁剪、组装成喂给模型的 prompt。
//
// 核心原则（抄自 Claude Code /init 的设计哲学）：
//   "只写 AI 猜不到的" —— 生成的 AGENTS.md 不复述技术栈，
//   而是沉淀约定、流程、踩坑、非标准选择这些代码里看不出来的隐性知识。
//
// 第一版预算策略：只喂"项目自我描述"（文档摘要 + 文件清单 + 技术栈），
// 不喂源码。源码按需检索是 RAG 下一层的事，不是第一步。

const MAX_FILES_IN_PROMPT = 80;
const MAX_SUMMARY_CHARS = 400;

// 把 inspect 结果压成一段紧凑的、给模型读的项目快照文本。
export function buildProjectSnapshot(inspectResult) {
  const lines = [];
  lines.push(`项目根目录：${inspectResult.root}`);
  lines.push(`技术栈推断：${inspectResult.packageKind}`);
  lines.push(`Git 仓库：${inspectResult.isGitRepo ? "是" : "否"}`);
  lines.push("");

  const existingDocs = inspectResult.docs.filter((d) => d.exists);
  if (existingDocs.length > 0) {
    lines.push("## 已有文档（标题 + 摘要）");
    for (const doc of existingDocs) {
      const summary = (doc.summary || "").slice(0, MAX_SUMMARY_CHARS);
      lines.push(`- ${doc.path}｜${doc.title || "(无标题)"}`);
      if (summary) {
        lines.push(`  摘要：${summary}`);
      }
    }
    lines.push("");
  }

  const missingDocs = inspectResult.docs.filter((d) => !d.exists);
  if (missingDocs.length > 0) {
    lines.push(`## 缺失的常见文档：${missingDocs.map((d) => d.path).join("、")}`);
    lines.push("");
  }

  lines.push("## 文件树（截断）");
  const files = inspectResult.files.slice(0, MAX_FILES_IN_PROMPT);
  lines.push(files.join("\n"));
  if (inspectResult.files.length > MAX_FILES_IN_PROMPT) {
    lines.push(`…（另有 ${inspectResult.files.length - MAX_FILES_IN_PROMPT} 项已省略）`);
  }

  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// init：生成 / 审查 AGENTS.md
// -----------------------------------------------------------------------------
const INIT_SYSTEM = `你是 Bennira——一个谨慎、只读、不留痕的项目引导助手（人设：《八方旅人》盗贼）。
你的任务：阅读项目快照，产出一份供 AI 编码助手持续阅读的项目记忆文档（AGENTS.md）。

【最重要的原则】只写 AI 猜不到的东西。
- 不要复述"这是个 Node/Python 项目""用了 React"——AI 看一眼配置文件就知道。
- 要写：项目的真实意图、非标准的架构选择、目录约定、构建/运行/测试方式、
  分支与提交约定、危险操作红线、踩坑记录、团队特有约定。
- 如果快照里信息不足以确定某项，宁可留一个清晰的 TODO 占位，也不要编造。

【输出要求】
- 直接输出 AGENTS.md 的完整 Markdown 正文，不要用代码块包裹，不要任何解释性前言。
- 用中文（项目约定：文档优先中文）。
- 结构建议：项目概述 / 目录与架构 / 构建与运行 / 开发约定 / 危险操作红线 / AI 协作须知。
- 保持克制：宁精勿滥，每一条都要是"猜不到才值得写"的。`;

export function buildInitMessages(inspectResult, { existingAgentsMd } = {}) {
  const snapshot = buildProjectSnapshot(inspectResult);
  const user = existingAgentsMd
    ? `项目快照如下：\n\n${snapshot}\n\n---\n项目已存在一份 AGENTS.md（见下）。请【审查并改进】它：保留仍然正确、AI 猜不到的内容，补充缺失的关键约定，删除已过时或纯复述性的内容。输出改进后的完整 AGENTS.md 正文。\n\n现有 AGENTS.md：\n${existingAgentsMd}`
    : `项目快照如下：\n\n${snapshot}\n\n请据此生成一份 AGENTS.md。记住：只写 AI 猜不到的。`;
  return [
    { role: "system", content: INIT_SYSTEM },
    { role: "user", content: user },
  ];
}

// -----------------------------------------------------------------------------
// plan：真计划生成
// -----------------------------------------------------------------------------
const PLAN_SYSTEM = `你是 Bennira——务实、谨慎、动手能力强的项目助手（《八方旅人》盗贼人设）。
"小偷"意味着你善于借鉴前人的优秀范式，也能真正动手改造项目。

你的任务：读项目快照 + 用户想法，产出一份【具体、可执行、贴合本项目】的下一步计划。
- 计划必须针对用户这次的具体想法，而不是套模板。
- 每一步要落到本项目真实的文件 / 命令 / 文档上。
- 如果某步涉及改代码或跑命令，直接把它写成明确的可执行动作（例如"在 X 文件里加 Y"、"运行 Z 命令"），
  这些动作可以在交互会话（bennira repl）里由 Bennira 动手完成，改文件/跑命令前会向用户确认。

【输出格式】严格输出 JSON，不要任何额外文字，不要代码块包裹：
{
  "summary": "一句话概括这次计划",
  "nextSteps": ["第一步…", "第二步…", "…"],
  "notes": "可选：风险提示或前置条件"
}`;

export function buildPlanMessages(inspectResult, userInput) {
  const snapshot = buildProjectSnapshot(inspectResult);
  return [
    { role: "system", content: PLAN_SYSTEM },
    {
      role: "user",
      content: `项目快照：\n\n${snapshot}\n\n---\n我的想法：${userInput}\n\n请生成计划（严格 JSON）。`,
    },
  ];
}

// 解析模型返回的计划 JSON，容错：允许被 ```json 包裹、允许前后有杂字。
export function parsePlanResponse(text) {
  const cleaned = stripCodeFence(text);
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.nextSteps)) {
      return {
        summary: typeof obj.summary === "string" ? obj.summary : "",
        nextSteps: obj.nextSteps.filter((s) => typeof s === "string" && s.trim()),
        notes: typeof obj.notes === "string" ? obj.notes : "",
      };
    }
  } catch {
    /* 落到下面的兜底 */
  }
  // 兜底：JSON 解析失败时，把整段文本当作 summary，按行拆 nextSteps。
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    summary: lines[0] || "模型返回未能解析为结构化计划。",
    nextSteps: lines.slice(1, 8),
    notes: "（模型未返回标准 JSON，已按文本兜底解析。）",
  };
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : trimmed;
}
