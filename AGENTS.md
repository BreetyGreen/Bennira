# Bennira 开发约定

## 项目概述

Bennira 是一个“项目养成型代码 Agent”，当前处于**小偷（Thief）版本**的奠基期。核心假设：用户需要一个先整理项目上下文、再逐步进入代码行动的 Agent。项目尚未有可运行的代码，当前阶段以文档和产品定义为主。

## 目录与架构

### 核心目录约定

- `docs/` — 所有产品、架构、策略文档，中文优先。**不要直接在根目录放设计文档**。
- `.agents/`、`.claude/`、`.workbuddy/` — 三套技能目录，内容完全同步（硬拷贝）。修改任一技能时，必须同步更新其他两份。
- `.workbuddy/memory/` — WorkBuddy 的每日记忆文件，格式 `YYYY-MM-DD.md`。**不要手动编辑**，由 WorkBuddy 自动维护。
- `assets/tech-graph/` — 架构图、流程图等正式 SVG/PNG 出图存放位置。

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

**当前阶段无可运行的代码。** 项目处于文档和产品定义阶段，没有 `package.json`、构建脚本或测试框架。任何尝试运行、构建或安装依赖的行为都是错误的。

## 开发约定

### 语言与命名

- 文档、需求讨论、版本命名：**中文优先**。
- 代码、分支、包名、技术术语：可用英文。
- 《八方旅人》职业名作为版本代号时，以中文职业名为正式名称（如“小偷”而非“Thief”）。

### 协作方式

- **不要假设项目目标已经完全确定。** 需求不清楚时，先把问题拆小，把可确定的部分写进文档。
- 重要产品判断必须沉淀到 `docs/` 目录，避免只存在于对话上下文。
- 修改代码或文档前，先检查现有文件和 Git 状态。
- 当用户提出模糊产品想法时，优先把想法整理成定位、需求、架构或路线图文档。

### 工程原则

- 小步提交，小步验证。
- 优先使用清晰、可恢复、可解释的实现。
- 文件修改尽量使用 patch，避免大范围无关重写。
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
- `docs/THIEF_MVP.md` — “小偷”版本 Alpha/MVP 范围。
- `docs/ROADMAP.md` — 版本路线图。
- `docs/CONTINUITY.md` — 换电脑、恢复环境、继续开发的流程。

## 危险操作红线

- **不要安装依赖或尝试运行项目** — 当前无可运行代码。
- **不要手动编辑 `.workbuddy/memory/` 下的文件** — 由 WorkBuddy 自动维护。
- **不要只修改一套技能目录** — 修改 `.agents/skills/`、`.cl
