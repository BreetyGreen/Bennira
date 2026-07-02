# 连续性与换机指南

这份文档的目标是确保换电脑、换 Codex 环境、换对话之后，Bennira 仍然可以继续推进。

## 当前状态

- 本地路径：`/Users/einar/Documents/Bennira`
- 当前大版本：`Bennira 一代 - 小偷`
- 当前阶段：小偷 Alpha CLI 起步
- 当前仓库状态：已初始化 Git，但尚未配置远程仓库

## 最重要的原则

不要把项目记忆只放在聊天记录里。

需要长期保留的信息，应写入仓库：

- 项目是什么：`README.md`
- 项目规则：`AGENTS.md`
- 一页说明：`docs/ONE_PAGE.md`
- 跨工具交接：`docs/HANDOFF.md`
- 上下文读取规则：`docs/CONTEXT_GUIDE.md`
- 版本规范：`docs/PROJECT_SPEC.md`
- 产品定义：`docs/PRODUCT_DEFINITION.md`
- 产品愿景：`docs/VISION.md`
- 产品定位：`docs/POSITIONING.md`
- 市场调研：`docs/MARKET_RESEARCH.md`
- 内核架构：`docs/ARCHITECTURE.md`
- Alpha/MVP 范围：`docs/THIEF_MVP.md`
- 路线图：`docs/ROADMAP.md`
- 换机恢复：`docs/CONTINUITY.md`

## 换电脑前应该做什么

1. 确认 Git 状态：

   ```bash
   git status
   ```

2. 提交当前文档：

   ```bash
   git add README.md AGENTS.md docs
   git commit -m "建立 Bennira 项目规范"
   ```

3. 创建远程仓库，例如 GitHub 上的 `Bennira`。

4. 关联远程仓库：

   ```bash
   git remote add origin <你的远程仓库地址>
   ```

5. 推送到远程：

   ```bash
   git push -u origin main
   ```

如果默认分支不是 `main`，以实际分支名为准。

## 换电脑后如何继续

1. 在新电脑安装 Git、Node.js 和 Codex。

2. 克隆仓库：

   ```bash
   git clone <你的远程仓库地址>
   cd Bennira
   ```

3. 打开 Codex，并让 Codex 先阅读：

   - `README.md`
   - `AGENTS.md`
   - `docs/HANDOFF.md`

   如果要继续具体任务，再按 `docs/CONTEXT_GUIDE.md` 读取相关文档，不要默认全量读取 `docs/`。

4. 对 Codex 说：

   ```text
   这是 Bennira 项目。请先阅读 README.md、AGENTS.md 和 docs/HANDOFF.md，再按 docs/CONTEXT_GUIDE.md 选择相关文档，继续推进“小偷 Alpha”。
   ```

## 切换到其他 AI 工具如何继续

切换到 Codex、Claude Code、Cursor 或其他工具前，先运行：

```bash
node ./packages/cli/src/index.mjs handoff
```

然后让新工具先读：

- `README.md`
- `AGENTS.md`
- `docs/HANDOFF.md`

如果新工具需要机器可读状态，再让它读取：

- `.bennira/state.json`
- `.bennira/logs/events.jsonl`
- `.bennira/last-plan.md`

关键原则：不要只依赖聊天记录；每次重要操作后都刷新 `docs/HANDOFF.md` 或写入事件日志。

## 现在还缺什么

- 远程 Git 仓库地址。
- 第一次 commit。
- 最小 CLI 的测试或验证脚本。
- 是否提交 `.bennira/` 事件日志到 Git。

## 建议的下一步

下一步建议继续完善“小偷 Alpha”的 CLI 体验、事件日志、交接文档和最小测试。
