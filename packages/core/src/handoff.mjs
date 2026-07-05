import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEventLog } from "./events.mjs";
import { readProjectMemory, updateProjectMemory } from "./memory.mjs";

export function createHandoff(root, inspectResult, options = {}) {
  const memory = readProjectMemory(root);
  const eventLog = readEventLog(root, { limit: options.limit ?? 8 });
  const lastPlan = readText(join(root, ".bennira", "last-plan.md"));
  const recentEvents = eventLog.events;
  const lastTaskEvent =
    [...recentEvents].reverse().find((event) => event.input) ??
    memory?.lastAction ??
    null;
  const nextSteps = memory?.nextSteps?.length
    ? memory.nextSteps
    : [
        "运行 `bennira status` 查看当前项目记忆。",
        "阅读 `docs/ROADMAP.md` 与 `CHANGELOG.md` 的 `[Unreleased]` 段，确认下一步任务。",
        "运行 `bennira plan \"<你要推进的目标>\"` 生成下一步计划。",
      ];

  const lines = [];
  lines.push("# Bennira 跨工具交接");
  lines.push("");
  lines.push("这份文档用于让 Codex、Claude Code、Cursor 或其他 AI 工具接续 Bennira 项目。");
  lines.push("");
  lines.push("## 当前项目状态");
  lines.push("");
  lines.push(`- 项目根目录：${root}`);
  lines.push(`- 当前阶段：${memory?.stage ?? "小偷 Alpha 已完成，向 MVP 推进（真 agent，可执行、可改代码、原生 tool_calls）"}`);
  lines.push(`- 版本线：${memory?.versionLine ?? "Bennira 一代 - 小偷"}`);
  lines.push(`- Git 仓库：${inspectResult.isGitRepo ? "是" : "否"}`);
  lines.push(`- 项目类型：${inspectResult.packageKind}`);
  lines.push("");
  lines.push("## 最近一次任务目标");
  lines.push("");
  lines.push(`- ${lastTaskEvent?.input ?? lastTaskEvent?.summary ?? "暂无记录"}`);
  lines.push("");
  lines.push("## 最近完成的操作");
  lines.push("");
  if (recentEvents.length === 0) {
    lines.push("- 暂无事件记录。");
  } else {
    for (const event of recentEvents) {
      lines.push(`- ${event.time} ${event.type}: ${event.summary}`);
    }
  }
  lines.push("");
  lines.push("## 当前未完成事项");
  lines.push("");
  lines.push("> 未完成事项以滚动文档为准，不在此写死，避免过时。请按以下顺序核对：");
  lines.push("- `docs/ROADMAP.md`：里程碑与阶段进度。");
  lines.push("- `CHANGELOG.md` 的 `[Unreleased]` 段：尚未发布、正在进行的改动。");
  lines.push("- `bennira status` 输出的项目记忆 `nextSteps`。");
  lines.push("");
  lines.push("## 下一步建议");
  lines.push("");
  for (const step of nextSteps) {
    lines.push(`- ${step}`);
  }
  lines.push("");
  lines.push("## 最近计划摘要");
  lines.push("");
  if (lastPlan) {
    lines.push(lastPlan.trim());
  } else {
    lines.push("暂无 `.bennira/last-plan.md`。");
  }
  lines.push("");
  lines.push("## 给其他 AI 工具的接续提示词");
  lines.push("");
  lines.push("```text");
  lines.push("这是 Bennira 项目：一个用 Node ESM 编写、零运行时依赖的中文 AI 编码 CLI（真 agent，非只读工具）。");
  lines.push("请先阅读 README.md、AGENTS.md、docs/HANDOFF.md，再看 docs/ROADMAP.md 与 CHANGELOG.md 的 [Unreleased] 段确认下一步。");
  lines.push("现状能力：真实 agent 循环，可执行 shell、可读写/修改业务代码、支持模型原生 tool_calls（role:tool 回喂观察）。");
  lines.push("工作约定：中文优先；先观察再动手；关键步骤写入事件日志或交接文档；改完代码务必跑 `node --test` 保持测试全绿；提交与推送用远程分支 master。");
  lines.push("恢复上下文（若本机有这些文件，注意它们不进 git、换机会丢）：`.bennira/state.json`、`.bennira/logs/events.jsonl`、`.bennira/last-plan.md`；换机后以 git 内的 docs/ 与 README/AGENTS 为准。");
  lines.push("```");
  lines.push("");

  return {
    path: "docs/HANDOFF.md",
    content: `${lines.join("\n")}\n`,
    warnings: eventLog.warnings,
  };
}

export function writeHandoff(root, inspectResult, options = {}) {
  const handoff = createHandoff(root, inspectResult, options);
  const path = join(root, handoff.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, handoff.content, "utf8");
  updateProjectMemory(root, {
    handoffPath: handoff.path,
    lastAction: {
      type: "handoff",
      summary: "刷新跨工具交接文档",
      files: [handoff.path],
    },
  });
  return handoff;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
