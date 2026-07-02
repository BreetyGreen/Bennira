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
        "运行 `bennira plan \"继续推进小偷 Alpha\"` 生成下一步计划。",
      ];

  const lines = [];
  lines.push("# Bennira 跨工具交接");
  lines.push("");
  lines.push("这份文档用于让 Codex、Claude Code、Cursor 或其他 AI 工具接续 Bennira 项目。");
  lines.push("");
  lines.push("## 当前项目状态");
  lines.push("");
  lines.push(`- 项目根目录：${root}`);
  lines.push(`- 当前阶段：${memory?.stage ?? "小偷 Alpha"}`);
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
  lines.push("- Context Reader 需要继续 provider 化。");
  lines.push("- 需要补最小测试或验证脚本。");
  lines.push("- TypeScript 编译链暂未引入，当前仍是零依赖 Node ESM。");
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
  lines.push("这是 Bennira 项目。请先阅读 README.md、AGENTS.md 和 docs/HANDOFF.md。");
  lines.push("当前目标是继续推进 `Bennira 一代 - 小偷 Alpha`。");
  lines.push("请遵守：中文优先；先观察再行动；所有关键步骤都要写入事件日志或交接文档；不要执行 shell、不修改业务代码、不做 patch，除非用户明确进入 MVP 阶段。");
  lines.push("如果需要恢复上下文，请读取 `.bennira/state.json`、`.bennira/logs/events.jsonl` 和 `.bennira/last-plan.md`。");
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
