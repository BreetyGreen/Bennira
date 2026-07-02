# 上下文读取指南

这份文档用于避免 Bennira 项目在后续对话中出现上下文爆炸。

## 默认只读

新会话或换电脑后，默认只需要先读这三个文件：

1. `README.md`
2. `AGENTS.md`
3. `docs/HANDOFF.md`

读完这三个文件，就能知道：

- Bennira 是什么。
- 当前协作规则是什么。
- 当前项目状态是什么。
- 为什么它不是简单复刻 Codex / Claude Code。
- 当前 Alpha 要做什么。
- 下一步应该做什么。

## 做产品讨论时再读

当任务是讨论定位、用户、差异化、路线图时，再读：

- `docs/ONE_PAGE.md`
- `docs/STRATEGY_REVIEW.md`
- `docs/POSITIONING.md`
- `docs/VISION.md`
- `docs/ROADMAP.md`

## 做技术设计时再读

当任务是设计内核、CLI、工具、权限、日志、插件边界时，再读：

- `docs/ARCHITECTURE.md`
- `docs/THIEF_MVP.md`

当任务涉及架构图、流程图、Agent 图、记忆图、技术图谱或正式 SVG/PNG 出图时，再读：

- `docs/TECH_GRAPH.md`

## 做竞品讨论时再读

当任务是讨论 Codex、Claude Code、Cursor、Cline、Aider 等产品时，再读：

- `docs/MARKET_RESEARCH.md`

当任务是讨论公开源码结构、agent runtime、工具/权限/上下文实现方式时，再读：

- `docs/SOURCE_RESEARCH.md`

## 做版本命名时再读

当任务涉及《八方旅人》职业版本、版本代号、路线命名时，再读：

- `docs/PROJECT_SPEC.md`

## 做换机或恢复时再读

当任务涉及换电脑、远程仓库、恢复项目上下文时，再读：

- `docs/CONTINUITY.md`

## 不要默认全量读取

除非用户明确要求完整审阅，否则不要在每次任务开始时读取整个 `docs/` 目录。

推荐做法：

1. 先读默认三件套。
2. 根据任务类型选择相关文档。
3. 用 `rg` 搜索具体关键词。
4. 只打开命中的相关段落。
