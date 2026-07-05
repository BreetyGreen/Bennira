# 连续性与换机指南

这份文档的目标是确保换电脑、换环境、换对话之后，Bennira 仍然可以继续推进。

## 当前状态

- 本地路径：`/Users/einar/Documents/Bennira`（换机后以你自己的 clone 路径为准）
- 当前大版本：`Bennira 一代 - 小偷`
- 当前阶段：Alpha 已完成，已是**可运行的真 agent**（可执行 shell、可改代码、支持原生 tool_calls）
- 仓库状态：已初始化 Git，**远程已配置**：`origin = https://github.com/BreetyGreen/Bennira.git`，默认分支 **`master`**
- 测试：`node --test` 全绿（core 15 个测试文件 + cli 1 个）

## 最重要的原则

不要把项目记忆只放在聊天记录或本机缓存里。

**只有进 git 的东西换机才带得走。** `.bennira/`（`state.json`、`logs/events.jsonl`、`last-plan.md`）和 `.workbuddy/memory/` 都在 `.gitignore` 里，换设备后一定会丢——它们只是本机运行时缓存，不要依赖它们续接。

需要长期保留、换机必须可读的信息，都在仓库里：

- 项目是什么：`README.md`
- 项目规则：`AGENTS.md`
- 跨工具交接（换机第一手状态）：`docs/HANDOFF.md`
- 上下文读取规则：`docs/CONTEXT_GUIDE.md`
- 内核架构：`docs/ARCHITECTURE.md`
- 路线图（下一步任务来源）：`docs/ROADMAP.md`
- 变更记录（`[Unreleased]` = 正在做的）：`CHANGELOG.md`
- 一页说明：`docs/ONE_PAGE.md`
- 产品定义 / 定位 / 愿景：`docs/PRODUCT_DEFINITION.md`、`docs/POSITIONING.md`、`docs/VISION.md`

## 换电脑前应该做什么

1. 确认 Git 状态干净：

   ```bash
   git status
   ```

2. 提交所有改动（代码 + 文档）：

   ```bash
   git add -A
   git commit -m "<描述本次改动>"
   ```

3. 推送到远程 `master`：

   ```bash
   git push origin master
   ```

> 远程与分支都已配置好，无需再 `git remote add` 或 `-u`。分支是 `master`，**不是 `main`**。

## 换电脑后如何继续

1. 在新电脑安装 Git、Node.js（≥ 18，项目用 `node --test`）。

2. 克隆仓库：

   ```bash
   git clone https://github.com/BreetyGreen/Bennira.git
   cd Bennira
   ```

3. 让接手的 AI 依次阅读：

   - `README.md`
   - `AGENTS.md`
   - `docs/HANDOFF.md`
   - `docs/ROADMAP.md` 与 `CHANGELOG.md` 的 `[Unreleased]` 段（这里是下一步任务）

   如果要继续具体任务，再按 `docs/CONTEXT_GUIDE.md` 读取相关文档，不要默认全量读取 `docs/`。

4. 跑一遍测试确认基线全绿：

   ```bash
   cd packages/core && node --test
   cd ../cli && node --test
   ```

5. 对接手的 AI 说：

   ```text
   这是 Bennira 项目：一个 Node ESM、零依赖的中文 AI 编码 CLI（真 agent，可执行 shell、可改代码、支持原生 tool_calls）。
   请先读 README.md、AGENTS.md、docs/HANDOFF.md，再看 docs/ROADMAP.md 与 CHANGELOG.md 的 [Unreleased] 段确认下一步，然后继续推进。
   改完代码务必跑 node --test 保持全绿；提交推送用 git push origin master。
   ```

## 切换到其他 AI 工具如何继续

在**同一台机器上**切换工具（Codex、Claude Code、Cursor 等）时，可先刷新交接文档：

```bash
node ./packages/cli/src/index.mjs handoff
```

然后让新工具先读 `README.md`、`AGENTS.md`、`docs/HANDOFF.md`。

> 只有在同机、且这些文件存在时，才让工具去读机器可读状态 `.bennira/state.json`、`.bennira/logs/events.jsonl`、`.bennira/last-plan.md`。**换机场景下这些文件不存在，跳过即可**——真实状态以 git 内的文档为准。

关键原则：不要只依赖聊天记录；每次重要操作后都提交 git，并在需要时刷新 `docs/HANDOFF.md`。

## 建议的下一步

当前规划中的下一步是 **apply_patch + diff 预览**：让 agent 改代码前先产出结构化 diff、经确认再落盘，替代直接整文件覆写。详见 `docs/ROADMAP.md` 与 `CHANGELOG.md` 的 `[Unreleased]`。
