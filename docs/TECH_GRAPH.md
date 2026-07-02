# Bennira 技术图谱规范

## 来源

本项目采用 `fireworks-tech-graph` 作为技术图谱参考规范。

- GitHub：`https://github.com/yizhiyanhua-ai/fireworks-tech-graph`
- 当前集成方式：项目级文档规范，不做全局 Codex skill 安装。
- 用途：统一 Bennira 的架构图、流程图、Agent 图、记忆图和后续 SVG/PNG 出图规则。

说明：全局安装第三方 skill 会改变本机 Codex 行为，当前先把可迁移的画图规则沉淀到仓库内。后续如果需要正式出 SVG/PNG，再按该 skill 的脚本链路生成和校验。

## 默认风格

当前文档优先使用 Mermaid，保持可读、可编辑、低维护成本。

正式出图时采用 `fireworks-tech-graph` 的 Style 7：OpenAI Official。

原因：

- 白底、轻边框、低装饰，适合架构文档。
- 颜色只表达语义，不做视觉噪声。
- 适合中文产品和技术说明混排。

## 图类型约定

| 场景 | 图类型 | 说明 |
| --- | --- | --- |
| 产品能力总览 | Architecture Diagram | 按能力域分层展示 |
| Agent 内核运行 | Agent Architecture Diagram | 展示输入、上下文、模型、工具、记忆、输出 |
| 项目记忆与日志 | Memory Architecture Diagram | 区分读路径、写路径和恢复路径 |
| CLI 命令行为 | Flowchart / Process Flow | 用步骤和分支表达命令流程 |
| 用户任务推进 | Data Flow Diagram | 标注想法、上下文、计划、事件、文档如何流动 |
| 后续版本路线 | Timeline / Gantt | 展示职业版本和能力解锁 |

## 节点语义

| 概念 | 建议形状 | Mermaid 表达 |
| --- | --- | --- |
| 用户 | 人或入口节点 | `User["用户"]` |
| Agent / 编排器 | 控制节点 | `Core["Agent Core"]` |
| 模型 | 圆角节点 | `Model["Model Adapter"]` |
| 工具 | 工具节点 | `Tool["Tool Registry"]` |
| 短期上下文 | 虚线或普通节点 | `Context["Context Engine"]` |
| 长期记忆 | 数据节点 | `Memory[("Project Memory")]` |
| 事件日志 | 数据节点 | `EventLog[("Event Log")]` |
| 文档资产 | 文件节点 | `Docs["docs/*.md"]` |
| 交接状态 | 文件节点 | `Handoff["docs/HANDOFF.md"]` |

## 箭头语义

| 流向 | 含义 | Mermaid 样式 |
| --- | --- | --- |
| 主路径 | 用户任务的主要执行链路 | 实线箭头 |
| 恢复路径 | 读取日志和文档恢复状态 | 实线箭头，标注“恢复” |
| 写入路径 | 写入状态、日志、文档 | 实线箭头，标注“写入” |
| 未来扩展 | 当前未实现但预留边界 | 虚线箭头 |
| 反馈循环 | 观察结果回到下一步计划 | 回环箭头 |

当同一张图出现两种以上箭头语义时，必须在图下方用文字说明。

## 布局规则

- 产品架构图优先自上而下：用户入口 -> 工作台 -> Agent 内核 -> 可信底座。
- 长期架构图优先分层：Interface -> Session -> Agent Core -> Context/Model/Orchestrator -> Tools/Permission/Executors -> Event/Memory。
- Alpha 架构图只画真实实现或已经开始落地的模块，不把未来能力画成已完成。
- 流程图节点文案尽量短，必要说明放在图后文字里。
- 中文图节点可以使用换行，但每个节点不超过两行。

## 生成 SVG/PNG 的规则

当需要从 Mermaid 升级到正式图片时：

1. 先确定图类型。
2. 抽取节点、分层、边、数据流和循环。
3. 采用 Style 7 的白底、轻边框、少量绿色主路径。
4. 箭头尽量正交走线，避免穿过节点。
5. SVG 生成后必须做 XML 校验。
6. 中文 PNG 导出优先用浏览器或 Puppeteer 路径，避免 Cairo 字体回退导致中文方块。
7. 输出 SVG 为主，PNG 为分享或演示附属物。

## Bennira 当前图谱清单

当前必须维护的图：

- `docs/ARCHITECTURE.md`：产品架构图、长期架构图、小偷 Alpha 架构图、Agent Core 循环图。
- `docs/ONE_PAGE.md`：产品价值流程图、长期架构简图、Alpha 实际架构图。
- `docs/PRODUCT_DEFINITION.md`：产品内核流程图、已有项目初始化流程图。

后续新增图时，优先更新本文件的清单，避免图散落后无人维护。

## 当前已生成资产

正式图谱资产保存在 `docs/assets/tech-graph/`。

文档内展示优先引用 PNG，SVG 作为可编辑源文件保留。原因是 Codex 的本地 Markdown/文件预览对相对路径 SVG 支持不稳定，而 PNG 在 Codex、浏览器、GitHub 和其他 Markdown 预览中更稳。

| 图 | SVG | PNG |
| --- | --- | --- |
| 产品架构图 | `product-architecture.svg` | `product-architecture.png` |
| 长期内核架构图 | `long-term-architecture.svg` | `long-term-architecture.png` |
| 小偷 Alpha 实际架构图 | `alpha-architecture.svg` | `alpha-architecture.png` |
| 产品内核流程图 | `product-core-flow.svg` | `product-core-flow.png` |
| 已有项目接入流程图 | `existing-project-flow.svg` | `existing-project-flow.png` |
| Agent Core 循环图 | `agent-core-loop.svg` | `agent-core-loop.png` |

本次生成方式：

- 按 `fireworks-tech-graph` 的 Python list method 直接生成 SVG。
- 使用 `fireworks-tech-graph/scripts/validate-svg.sh` 校验 SVG。
- 当前机器没有 `cairosvg` 和 `rsvg-convert`，PNG 使用 macOS `sips` 从 SVG 导出。
- Chrome headless 曾成功导出单张 PNG，但批量导出时会卡住；后续优先使用 `cairosvg` 或 `sips`，需要像素级浏览器渲染时再排查 Chrome profile/timeout。

当前全局 skill 路径：

```text
/Users/einar/.codex/skills/fireworks-tech-graph
```

注意：Codex 当前会话的 skill 列表通常不会热加载新安装的 skill。新开会话后才能直接在技能列表里看到它；在当前会话内可以直接读取上面的本地路径和脚本。
