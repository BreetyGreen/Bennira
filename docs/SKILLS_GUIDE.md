# 技能使用指南（gstack / taste-skill）

本文件汇总 Bennira 项目引入的外部技能：**装在哪、谁能用、什么时候用、怎么调**。
面向 Codex / Claude Code / WorkBuddy 三个 agent 协作的场景，是 `AGENTS.md` 中「设计与工作流技能」一节的完整版。

---

## 1. 协作模型（先理解这个）

本项目由三个 AI agent 接力操作同一个仓库：

| Agent | 读技能的位置 |
|-------|-------------|
| Claude Code | `~/.claude/skills/`（全局）或 `<仓库>/.claude/skills/`（项目级） |
| WorkBuddy | `~/.workbuddy/skills/`（用户级）或 `<仓库>/.workbuddy/skills/`（项目级） |
| Codex | `~/.agents/skills/`（用户级）或 `<仓库>/.agents/skills/`（仓库级）；也读 `AGENTS.md` 约定 |

**关键事实：三个 agent 没有公用技能目录。** "装一次三个都能用"字面上不成立。
真正能让三方共享的唯一办法：**把技能装进项目仓库、随 Git 走**——这样任何在 Bennira 上干活的 agent 都能读到同一份。

---

## 2. taste-skill（前端审美 / 反 AI 味）✅ 三个 agent 都能用

### 是什么
纯 Markdown 规则集，本质是给 agent 请了个"设计审稿人"，专治"深色紫蓝渐变 + 三张假卡片"那种一眼假的模板味。做前端前先判断设计方向，再写代码。

- **适用**：落地页、官网、作品集、SaaS 营销页、UI 重构。
- **不适用**：仪表盘、数据表、多步产品 UI（这类别硬套，会适得其反）。

### 装在哪（随 Git 走，三方通吃）
- `<仓库>/.claude/skills/`（Claude Code 读）
- `<仓库>/.workbuddy/skills/`（WorkBuddy 读）
- `<仓库>/.agents/skills/`（Codex 读，仓库级）
- `~/.workbuddy/skills/`（WorkBuddy 用户级另有一份）
- 13 个技能，纯 Markdown，无可执行脚本（已做安全核实）。

### 常用技能名（frontmatter `name`）

| 技能名 | 什么场景用 |
|--------|-----------|
| `design-taste-frontend` | **默认首选**。做新页面（落地页 / 官网 / 文档站 / 作品集） |
| `redesign-existing-projects` | 已有页面太"AI 味"，要审计并翻新（审计优先，不乱改内容） |
| `high-end-visual-design` | 想要高级感、贵感、精致质感，大量留白 |
| `minimalist-ui` | 极简克制，Notion / Linear 风格 |
| `industrial-brutalist-ui` | 瑞士排版 / 工业粗野风，强对比 |
| `gpt-taste` | GPT / Codex 专用，更激进的反模板 |
| `brandkit` | 品牌视觉系统（Logo 方向、配色、字体、品牌应用） |

### 怎么用

**在 WorkBuddy 里**：直接提需求即可，会自动挂对应技能。
- 「给 Bennira 做个落地页」→ 自动走 `design-taste-frontend`
- 「这页面太丑，重新设计下」→ 自动走 `redesign-existing-projects`
- 也可直接点名：「用 `high-end-visual-design` 帮我设计」。

**在 Claude Code 里**：对话里提技能名即可自动挂载，或让它读项目 `.claude/skills/`。

**在 Codex 里**（重要，别用 slash 命令）：
- 技能已装进 `<仓库>/.agents/skills/`，Codex 会读到。
- 调用方式是**在对话里提技能名**，或用 **`$design-taste-frontend`** 显式调用。
- ⚠️ **不是 `/design`**：`/design` 是 gstack 的 Claude Code slash 命令，Codex 里不存在。Codex 的 `/xxx` 走的是另一套 custom prompts 机制（`~/.codex/prompts/`，官方已标记废弃），技能不走这条路。

**三个可调旋钮**（点名技能时可附带）：
```
使用 design-taste-frontend，DESIGN_VARIANCE 7，MOTION_INTENSITY 4，VISUAL_DENSITY 3
```
- `DESIGN_VARIANCE`：设计大胆程度（越高越出格）
- `MOTION_INTENSITY`：动效强度
- `VISUAL_DENSITY`：信息密度

---

## 3. gstack（角色化开发工作流）⚠️ 仅 Claude Code 能用

### 是什么
Garry Tan（YC CEO）开源的 Claude Code 技能套件，把「思考→规划→构建→审查→测试→交付→复盘」整套开发流程编码成 55 个角色化 slash command。

### 为什么只有 Claude Code 能用（两个硬约束）
1. **天生为 Claude Code 而生**：它的 slash command（`/office-hours` 等）只能在 Claude Code 运行时里触发；`setup` 脚本把技能软链进 `~/.claude/skills/`，这个目录 Codex 和 WorkBuddy 根本不扫。
2. **体积太大，无法入仓共享**：整体约 1.1G（`node_modules` 就 741M），塞进刚起步的 Bennira 会撑爆仓库、污染 handoff。所以只能**全局装一份**，物理上出不了 `~/.claude/`。

> 一句话：gstack 是装在 Claude Code 家里的重家具，搬不走，只有住这屋的 Claude Code 能用。

### 装在哪
- **仅全局** `~/.claude/skills/gstack/`（**不入仓**）。
- 依赖 Bun（已装在 `~/.bun`，版本 1.3.14）。

### 常用命令（在 Claude Code 里敲）
| 命令 | 作用 |
|------|------|
| `/office-hours` | 描述当前在做什么，让它进入状态 |
| `/plan-ceo-review` | 产品/需求评审 |
| `/plan-eng-review` | 架构锁定 |
| `/design-review` | 设计审查 |
| `/review` | 代码审查 |
| `/qa` | 浏览器端到端测试 |
| `/ship` | 发布 |

### 想让 Codex / WorkBuddy 也用它的思路？
不要搬 gstack（搬不动）。正确做法是把它的流程理念抽成几个轻量 `SKILL.md` 放进仓库。当前阶段无必要，跨工具协作时以 **taste-skill 作为共享审美基线**即可。

---

## 4. 一句话速查

- **要做/改前端页面** → 任何 agent 用 taste-skill（默认 `design-taste-frontend`）。
- **在 Claude Code 里想走完整开发流程** → 用 gstack 的 slash command。
- **跨工具共享的只有 taste-skill**；gstack 是 Claude Code 专属。
