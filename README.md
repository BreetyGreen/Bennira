# Bennira

> 一个中文优先、可恢复、可观察的本地代码 Agent CLI。

[![CI](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml/badge.svg)](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
![Zero deps](https://img.shields.io/badge/dependencies-0-blue.svg)

**English** → [README.en.md](./README.en.md)

Bennira 是一个探索中的本地代码 Agent。它的方向类似 Codex / Claude Code：进入一个代码库，理解项目结构，和你连续对话，调用工具，小步修改文件并跑命令，通过事件日志和交接文档形成可恢复的闭环。

它的差异化不在于复刻，而在于**把一个模糊的中文想法，沉淀成可恢复、可继续、可逐步执行的项目状态**。

版本线命名取自《八方旅人》职业系统——当前是「小偷（Thief）」，寓意早期大量借鉴、灵活轻巧。

---

## 特性

- 🗣️ **交互式 REPL** —— 裸敲 `bennira` 进入持久会话，连续对话、上下文累积。
- 🌊 **流式输出** —— 接入 OpenAI 兼容协议（如 DeepSeek），回答逐字冒出。
- 🤖 **Agentic 能力** —— 能读文件、改代码、跑命令，走 ReAct 循环（思考 → 调工具 → 观察 → 再想）。危险动作前先征求确认。
- 🎨 **八方旅人职业配色** —— 8 套主题一键切换，支持真彩色终端。
- 🔒 **谨慎的安全边界** —— 凭证只存本地、绝不入库；网络权限默认关闭；路径锁死在项目根内。
- 📦 **零运行时依赖** —— 纯 Node.js ESM，原生 `fetch` 直连模型，无 SDK。

---

## 快速开始

### 环境要求

- Node.js **>= 20**

### 安装

```bash
git clone https://github.com/BreetyGreen/Bennira.git
cd Bennira
npm install        # 仅链接 workspace，无第三方依赖
```

### 配置全局 `bennira` 命令（像 `claude` 一样直接用）

```bash
cd packages/cli
npm link           # 注册一次，之后任意目录都能敲 bennira
```

之后在任意目录：

```bash
bennira setup      # 首次设置向导
bennira status     # 查看状态
bennira            # 进入交互 REPL
```

> 不想全局注册也行，直接 `node ./packages/cli/src/index.mjs <命令>` 或 `npm run bennira -- <命令>`。

### 首次设置

```bash
bennira setup
```

向导会依次询问 6 项：

| # | 问题 | 示例 |
|---|---|---|
| ① | 配置作用域 | `global`（所有项目共享）/ `project`（仅当前） |
| ② | 职业配色 | `thief` |
| ③ | 模型 baseURL | `https://api.deepseek.com` |
| ④ | 模型名称 | `deepseek-chat` |
| ⑤ | API key | 你的 key（存本地 `secrets.json`，自动 gitignore + chmod 600） |
| ⑥ | 允许联网 | `y` |

> **凭证安全**：key 只写入 `.bennira/secrets.json`，绝不进 `config.json`、绝不入库。在 project 作用域配 key 时，Bennira 会**自动**把 `secrets.json` 加进 `.gitignore`。也可用环境变量 `BENNIRA_API_KEY` 注入（CI / 生产推荐）。

配好后 `bennira status` 显示「✓ 已就绪」即可开始。

---

## 命令一览

| 命令 | 需要模型 | 作用 |
|---|---|---|
| `bennira`（裸命令）| ✓ | 进入交互式 REPL 会话 |
| `setup` | ✗ | 首次设置：主题 / 模型 / 网络权限 |
| `inspect [path]` | ✗ | 观察项目结构、Git 状态、关键文档 |
| `init [path]` | ✓ | 读懂项目并生成 / 更新 `AGENTS.md` |
| `status [path]` | ✗ | 查看 Bennira 与模型状态（支持 `--json`） |
| `plan "中文想法"` | ✓ | 结合项目状态生成下一步计划（支持 `--no-write`） |
| `log [--limit N]` | ✗ | 查看最近事件日志 |
| `handoff` | ✗ | 刷新 `docs/HANDOFF.md` 跨工具交接文档 |
| `theme [list\|use\|set\|reset]` | ✗ | 查看 / 切换 / 自定义配色 |

> 追加 `--no-color` 或设置 `NO_COLOR` 可强制纯文本输出。

---

## REPL 里能做什么

进入 `bennira` 后，用自然中文说话即可：

```
你 › 帮我看看 packages/core 里都有什么
你 › 给 README 加一段安装说明        # 写文件前会问你 y/N
你 › 跑一下测试                       # 执行命令前会问你 y/N
```

内置 slash 命令：`/help` `/status` `/clear` `/exit`。

**安全保障**：改文件、跑命令前一律先征求确认；路径锁死在项目根内，防 `../` 逃逸；每个动作都写入事件日志。

---

## 架构

Monorepo，两个包：

- **`@bennira/core`** —— 纯逻辑内核：配置分层、凭证隔离、模型 provider（流式 + 非流式）、agent 协议、主题系统、事件日志。零依赖、可离线单测。
- **`@bennira/cli`** —— 命令行外壳：REPL、setup 向导、命令路由、工具执行与确认交互。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 开发

```bash
npm test              # 运行全部单测（node:test，零依赖，无需 API key）
npm run test:smoke    # 无 key 冒烟测试：验证只读命令能启动
```

测试全部离线、不需要真实 key —— 测的是纯逻辑（配置合并、凭证优先级、plan 解析、主题降级、gitignore 保护）。CI 在无 key 环境下也能全绿。

---

## 文档

- [产品定义](docs/PRODUCT_DEFINITION.md)
- [内核架构](docs/ARCHITECTURE.md)
- [小偷版本 MVP](docs/THIEF_MVP.md)
- [路线图](docs/ROADMAP.md)
- [上下文读取指南](docs/CONTEXT_GUIDE.md)
- [跨工具交接](docs/HANDOFF.md)

---

## 路线图

- [x] 小偷 Alpha：项目观察、记忆、事件日志、跨工具交接
- [x] 流式输出 + Spinner + 交互式 REPL
- [x] 突破只读：agentic 改文件 / 跑命令（带确认）
- [ ] 更细粒度的权限门与 diff 预览
- [ ] MCP / 插件加载
- [ ] 多 Agent 协作

详见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 贡献

欢迎 issue 与 PR。提交前请跑 `npm test` 确保全绿。

## 许可证

[MIT](./LICENSE) © 2026 BreetyGreen
