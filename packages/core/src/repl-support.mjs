// repl-support.mjs —— REPL 的可测纯逻辑（补全 / 历史）
// -----------------------------------------------------------------------------
// 把 REPL 里"值得单测但不该耦合 readline/fs 副作用"的逻辑抽到 core：
//   1. slash 命令补全（completer）：抄 Codex / Claude Code 的 Tab 补全体验。
//   2. 命令历史的载入 / 追加（内存部分）：跨会话记住你敲过什么，上箭头可调。
//
// 真正的 fs 读写、readline 绑定仍在 CLI 层——这里只做纯数据变换，离线可测。

// REPL 内可用的 slash 命令清单（补全 + /help 都以此为单一事实源）。
export const SLASH_COMMANDS = Object.freeze([
  { name: "/help", desc: "显示帮助" },
  { name: "/status", desc: "查看模型就绪状态" },
  { name: "/init", desc: "读懂项目并生成 / 改进 AGENTS.md" },
  { name: "/plan", desc: "结合项目状态生成下一步计划（/plan 你的想法）" },
  { name: "/clear", desc: "清空会话上下文" },
  { name: "/exit", desc: "退出会话" },
]);

// readline completer：给定当前行，返回 [匹配项, 命中的前缀]。
// 只在以 "/" 开头时补全 slash 命令；其余情况不补全（返回空列表 + 原串）。
// 语义遵循 node:readline 的 completer 约定：返回 [completions, line]。
export function slashCompleter(line) {
  const s = String(line ?? "");
  if (!s.startsWith("/")) return [[], s];
  // 只在"还没打空格"（即还在敲命令名本身）时补全。
  if (/\s/.test(s)) return [[], s];
  const names = SLASH_COMMANDS.map((c) => c.name);
  const hits = names.filter((n) => n.startsWith(s));
  // 无匹配时按 readline 约定返回全集，避免它吞掉输入。
  return [hits.length ? hits : names, s];
}

// 归一命令历史：去掉空行、去掉连续重复、截断到上限。
// 存储顺序统一为"从旧到新"（最新在数组末尾），便于 append 语义。
export function normalizeHistory(lines, { limit = 500 } = {}) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = String(raw ?? "").replace(/\r?\n/g, " ").trim();
    if (!line) continue;
    if (out.length && out[out.length - 1] === line) continue; // 折叠连续重复
    out.push(line);
  }
  return out.length > limit ? out.slice(out.length - limit) : out;
}

// 把一条新输入并入历史（用于退出时写回）。返回归一后的新数组。
// 不改传入数组（纯函数）。空 / 与末尾重复的输入会被 normalizeHistory 折叠掉。
export function appendHistory(existing, line, opts = {}) {
  return normalizeHistory([...(Array.isArray(existing) ? existing : []), line], opts);
}
