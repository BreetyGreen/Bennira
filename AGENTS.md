# Bennira 开发约定

## 项目概述

Bennira 是一个「项目养成型代码 Agent」，当前处于**小偷（Thief）版本**的 Alpha 阶段（`0.1.0-alpha.0`）。核心假设：用户需要一个先整理项目上下文、再逐步进入代码行动的 Agent。

**项目已有可运行的代码**：零外部依赖的 Node.js monorepo，一个真正的 agent CLI（ReAct 循环 + 工具调用 + 命令执行 + 审批），约 6600 行、183 个测试全绿。全局命令 `bennira` 已可用。

## 目录与架构

### 核心目录约定

- `packages/` — monorepo 双包（见下）。**源码在这里，不在根目录。**
- `docs/` — 所有产品、架构、策略文档，中文优先。**不要直接在根目录放设计文档**。
- `.agents/`、`.claude/`、`.workbuddy/` — 三套技能目录，内容完全同步（硬拷贝）。修改任一技能时，必须同步更新其他两份。
- `.workbuddy/memory/` — WorkBuddy 的每日记忆文件，格式 `YYYY-MM-DD.md`。**不要手动编辑**，由 WorkBuddy 自动维护。
- `assets/tech-graph/` — 架构图、流程图等正式 SVG/PNG 出图存放位置。

### 代码架构（monorepo）

零外部依赖（根 `package.json`、`@bennira/core` 均无 `dependencies`；`@bennira/cli` 唯一依赖是 `@bennira/core` 自身），全程 Node 内置模块（`node:fs` / `node:readline` / `fetch` / `node:test`）。`type: "module"`，`engines.node >= 20`。

- **`packages/core`**（纯逻辑，可离线单测，不碰 IO 副作用）
  - `model.mjs` — OpenAI 兼容 provider：`generate` / `generateStream`（返回 string，5 个调用者）+ **`generateWithTools`**（原生 `tool_calls`，返回 `{ text, toolCalls, finishReason }`）；`UserAbortError` / `classifyAbort` 错误分层。
  - `agent.mjs` — `AGENT_TOOLS`（6 工具 + JSON Schema）、`AGENT_TOOL_RISK`、`buildAgentMessages`、`parseAgentAction`（文本 JSON fallback 解析）、**`toolSchemas()`**（→ OpenAI `tools[]`）、**`actionFromToolCall()`**（tool_call → 统一动作，坏 JSON 不静默当 finish）。
  - `theme.mjs` — 主题/ANSI 上色，色深检测（`Apple_Terminal → 256`）+ 真彩色→256 降级 + OSC 11 背景明暗探测。
  - `prompt.mjs` — 零依赖方向键菜单（raw mode + 键解码 + 原地重绘）。
  - 其余：`context.mjs` / `workspace.mjs`（项目扫描快照）、`secrets.mjs`（多 key 数据层）、`scope.mjs`、`memory.mjs`、`events.mjs`、`handoff.mjs`、`format.mjs`、`spinner.mjs`、`input-support.mjs`、`repl-support.mjs`。
- **`packages/cli`**（副作用层：动文件、跑命令、终端交互）
  - `index.mjs` — 入口 + 命令路由（`bin` 指向它）。
  - `repl.mjs` — 交互式 REPL + **agent loop**（`runAgentTurn`：能力探测分叉，原生 `tool_calls` 主干 / 老路窄兜底；`executeTool` 执行 6 工具）。

### Agent 能力现状（真 agent，非玩具）

- **循环**：ReAct，`MAX_STEPS=12`，思考 → 工具 → 观察回喂 → finish。
- **工具**：`read_file` / `list_files` / `search`（safe）、`write_file` / `run_command`（danger，执行前 y/N 审批）、`finish`。
- **工具调用协议**：优先 OpenAI 原生 `tool_calls`（`role:"tool"` + `tool_call_id` 配对回喂）；provider 不支持时回退 `parseAgentAction`（`role:"user"` + `[观察]`）。这是**严格超集**，两路都有测试锚定。
- **尚未做（路线图）**：`apply_patch`（现为全量覆盖 `write_file`）、OS 级沙箱（现为 `execSync` 裸跑 + 审批）、MCP/Skills/Hooks 扩展生态、多会话 resume/fork。

### 技能系统

项目引入了两套外部技能：

1. **taste-skill（前端审美 / 反 AI 味）** — 存放于 `.agents/skills/`、`.claude/skills/`、`.workbuddy/skills/`（三处同步）。用于落地页、官网、作品集等前端设计，**不适用于**仪表盘、数据表、多步产品 UI。调用方式：对话中提技能名，Codex 用 `$技能名` 显式调用（不是 `/` slash 命令）。

2. **gstack（角色化开发工作流）** — 仅 Claude Code 可用，存放于 `~/.claude/skills/gstack/`（**不入仓**，体积约 1.1G，含 node_modules）。依赖 Bun（已装在 `~/.bun`）。常用命令：`/office-hours`、`/plan-ceo-review`、`/plan-eng-review`、`/design-review`、`/review`、`/qa`、`/ship`。

### 文档读取顺序

新会话默认只读三个文件：
1. `README.md`
2. `AGENTS.md`（本文档）
3. `docs/HANDOFF.md`

不要默认全量读取 `docs/`。根据任务类型按 `docs/CONTEXT_GUIDE.md` 指引读取。

## 构建与运行

**项目已可运行。** 零外部依赖，克隆后无需 `npm install` 即可跑（`@bennira/cli` 仅依赖同仓 `@bennira/core`）。

- 全局命令：`bennira`（已 `npm link`，软链直指源码，改代码即时生效）。
- 常用命令（顶层）：`setup`（配置向导）、`repl` / 无参（进 REPL 对话）、`chat`、`shell`、`inspect`、`init`、`status`、`plan`、`log`、`handoff`、`theme`、`key`、`help`。
  - `theme` 子命令：`list` / `show` / `use` / `set` / `reset` / `appearance` / `bg`。
  - `key` 子命令：`list` / `add` / `use` / `remove`。
- npm scripts：`npm test`（= `node --test`，183 测试全绿）、`npm run bennira`、`npm run inspect` / `status` / `log` / `handoff`、`npm run test:smoke`。
- 从零使用三步：`bennira setup` → `bennira key add`（若 setup 里跳过了 key）→ `bennira`。

## 开发约定

### 语言与命名

- 文档、需求讨论、版本命名：**中文优先**。
- 代码、分支、包名、技术术语：可用英文。
- 《八方旅人》职业名作为版本代号时，以中文职业名为正式名称（如「小偷」而非「Thief」）。

### 协作方式

- **不要假设项目目标已经完全确定。** 需求不清楚时，先把问题拆小，把可确定的部分写进文档。
- 重要产品判断必须沉淀到 `docs/` 目录，避免只存在于对话上下文。
- 修改代码或文档前，先检查现有文件和 Git 状态。
- 当用户提出模糊产品想法时，优先把想法整理成定位、需求、架构或路线图文档。

### 工程原则

- 小步提交，小步验证。
- 优先使用清晰、可恢复、可解释的实现。
- 文件修改尽量使用 patch，避免大范围无关重写。
- **改核心副作用代码（`repl.mjs` loop、`executeTool`、`model.mjs`）前先有回归网**：`packages/cli/test/agent-loop.test.mjs` 用 fake-provider 注入，覆盖原生 + fallback 两路。改动前先跑绿锚定旧行为，改后再验。
- **零依赖是硬约束**：不引入外部 npm 包（chalk / inquirer / openai SDK 等能力均手写子集）。新增能力优先用 Node 内置。
- 删除、重命名、重置 Git 历史等破坏性操作必须明确确认。

### 文档规则

- `README.md` — 项目是什么，以及当前怎么继续。
- `docs/CONTEXT_GUIDE.md` — 上下文读取规则，避免每次全量读取文档。
- `docs/HANDOFF.md` — 跨工具交接状态（Codex、Claude Code、Cursor 等）。
- `docs/TECH_GRAPH.md` — 架构图、流程图、Agent 图和正式 SVG/PNG 出图规范。
- `docs/SKILLS_GUIDE.md` — gstack / taste-skill 技能的完整使用指南。
- `docs/PROJECT_SPEC.md` — 项目规范和版本命名规则。
- `docs/PRODUCT_DEFINITION.md` — 产品定义和核心主张。
- `docs/POSITIONING.md` — 产品定位。
- `docs/VISION.md` — 产品愿景和长期方向。
- `docs/STRATEGY_REVIEW.md` — 策略自我校准、风险和待验证假设。
- `docs/MARKET_RESEARCH.md` — 市场与竞品调研。
- `docs/SOURCE_RESEARCH.md` — 公开源码调研、架构借鉴和实现取舍。
- `docs/ARCHITECTURE.md` — 内核架构草案。
- `docs/THIEF_MVP.md` — 「小偷」版本 Alpha/MVP 范围。
- `docs/ROADMAP.md` — 版本路线图。
- `docs/CONTINUITY.md` — 换电脑、恢复环境、继续开发的流程。
- `docs/TASK_TOOLCALLS.md` — 原生 tool_calls 改造执行清单（T1~T4，已完成）。

## 危险操作红线

- **不要手动编辑 `.workbuddy/memory/` 下的文件** — 由 WorkBuddy 自动维护。
- **不要只修改一套技能目录** — 修改 `.agents/skills/`、`.claude/skills/`、`.workbuddy/skills/` 中任一份时，必须同步其余两份。
- **不要引入外部 npm 依赖** — 零依赖是项目硬约束，能力用 Node 内置手写。
- **不要在没有回归网的情况下盲改 agent loop / executeTool / model.mjs** — 先跑 `packages/cli/test/agent-loop.test.mjs` 锚定旧行为。
- **删除、重命名、重置 Git 历史等破坏性操作必须明确确认。**
