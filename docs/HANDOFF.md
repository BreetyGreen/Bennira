# Bennira 跨工具交接

这份文档用于让 Codex、Claude Code、Cursor 或其他 AI 工具接续 Bennira 项目。它是进 git 的“换机第一手状态”快照——`.bennira/`、`.workbuddy/` 都不进 git，换设备后只有本文件、`README.md`、`AGENTS.md`、`docs/` 是可靠的。

> 本文件可由 `bennira handoff` 重新生成；生成器（`packages/core/src/handoff.mjs`）已不再写死过时状态，会引导接手方去读滚动文档。若手动更新，请同步更新下方“快照日期”。

**快照日期：2026-07-05**

## 当前项目状态

- 项目根目录：`/Users/einar/Documents/Bennira`（换机后以你自己的 clone 路径为准）
- 版本线：Bennira 一代 - 小偷
- 阶段：Alpha 已完成，已经是**可运行的真 agent**（不再是只读/只观察的骨架）
- 项目类型：Node ESM monorepo（`packages/core` + `packages/cli`），**零运行时依赖**
- Git：远程 `origin = https://github.com/BreetyGreen/Bennira.git`，**默认分支 `master`**（不是 `main`）
- 测试：`node --test` 全绿（core 15 个测试文件 + cli 1 个 `agent-loop`）

## Bennira 现在能做什么（真实能力，不要低估）

- **真实 agent 循环**：会观察项目、规划、调用工具、把结果回喂给模型继续推进，直到任务完成。
- **可执行 shell、可读写并修改业务代码**——这是一个会动手的编码助手，不是只读工具。
- **模型原生 tool_calls**：走 provider 原生 `tool_calls`，工具执行结果以 `role:tool` 消息回喂（最近的 T1~T4 改造已收工并推送）。
- 交互式 REPL：持久会话、真流式输出、Ctrl+C 中断当前轮、slash 命令（`/init`、`/plan` 等）+ Tab 补全 + 跨会话命令历史。
- 多行输入与 `@文件` 引用。
- 多服务商 / 多 key：`bennira key list|add|use|remove`，内置各家模型目录 + 配 key 后实时拉取合并。
- 终端主题自适应：OSC 11 背景色探测 + 色彩深度检测（真彩色不支持时降级 256 色），盗贼紫主题。

## 最近完成的操作（以 git 提交为准）

- `3a6fff2` docs: 更新过时 AGENTS.md + 收尾原生 tool_calls 改造（T4）
- `96e58c4` feat(cli): agent loop 切到原生 tool_calls（T3，收敛主干）
- `482e45d` feat(core): 原生 tool_calls 能力（T2，只加不改）
- `464dfcb` test(cli): fake-provider 回归网 + runAgentTurn 可注入 provider（T1）
- `0dca2c2` docs: 原生 tool_calls 改造执行清单

## 当前未完成事项 / 下一步

> 以滚动文档为准，不在此写死。核对顺序：`docs/ROADMAP.md` → `CHANGELOG.md` 的 `[Unreleased]` 段 → `bennira status`。

当前规划中的下一步是 **apply_patch + diff 预览**：让 agent 改代码前先产出结构化 diff、经确认再落盘，替代直接整文件覆写。

## 换设备后如何续接（重要）

1. `git clone https://github.com/BreetyGreen/Bennira.git && cd Bennira`
2. 依次读 `README.md` → `AGENTS.md` → 本文件 → `docs/ROADMAP.md` → `CHANGELOG.md` 的 `[Unreleased]`。
3. `node --test`（在 `packages/core` 与 `packages/cli` 下）确认基线全绿。
4. 从上面“下一步”接着做；改完代码务必再跑 `node --test` 保持全绿。
5. 提交推送用 `git push origin master`（不是 `main`）。

> 注意：`.bennira/state.json`、`.bennira/logs/events.jsonl`、`.bennira/last-plan.md`、`.workbuddy/memory/` 都在 `.gitignore` 里，**换机不会带过来**。它们只是本机运行时缓存，缺失不影响续接——真实状态以本文件与 git 内文档为准。

## 给其他 AI 工具的接续提示词

```text
这是 Bennira 项目：一个用 Node ESM 编写、零运行时依赖的中文 AI 编码 CLI（真 agent，非只读工具）。
请先阅读 README.md、AGENTS.md、docs/HANDOFF.md，再看 docs/ROADMAP.md 与 CHANGELOG.md 的 [Unreleased] 段确认下一步。
现状能力：真实 agent 循环，可执行 shell、可读写/修改业务代码、支持模型原生 tool_calls（role:tool 回喂观察）。
工作约定：中文优先；先观察再动手；关键步骤写入事件日志或交接文档；改完代码务必跑 `node --test` 保持测试全绿；提交与推送用远程分支 master。
下一步任务方向：apply_patch + diff 预览（改代码前先产出结构化 diff、经确认再落盘）。
恢复上下文时注意：.bennira/ 与 .workbuddy/ 不进 git、换机会丢；换机后以 git 内的 docs/ 与 README/AGENTS 为准。
```
