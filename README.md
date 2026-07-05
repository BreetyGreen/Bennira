# Bennira

> 一个中文优先、可恢复、可观察的本地代码 Agent CLI。

[![CI](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml/badge.svg)](https://github.com/BreetyGreen/Bennira/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
![Zero deps](https://img.shields.io/badge/dependencies-0-blue.svg)
![Tests](https://img.shields.io/badge/tests-183%20passing-brightgreen.svg)

**English** → [README.en.md](./README.en.md)

Bennira 是一个探索中的本地代码 Agent。它的**产品体验对齐 Codex / Claude Code**：进入一个代码库，理解项目结构，和你连续对话，调用工具，小步修改文件并跑命令，通过事件日志和交接文档形成可恢复的闭环。

它的差异化不在于复刻，而在于**把一个模糊的中文想法，沉淀成可恢复、可继续、可逐步执行的项目状态**。

版本线命名取自《八方旅人》职业系统——当前是「小偷（Thief）」，寓意早期大量借鉴、灵活轻巧。

---

## 特性

- 🗣️ **交互式 REPL** —— 裸敲 `bennira` 进入持久会话，连续对话、上下文累积、跨会话历史持久化。
- 🌊 **真流式输出** —— 原生 `fetch` 直连 OpenAI 兼容协议（如 DeepSeek），SSE 逐 token 冒出。
- ⛔ **Ctrl+C 中断当前轮** —— 停下正在跑的这一轮回到提示符，不退出进程；「用户中断」与「超时/网络失败」被精确区分。
- 🤖 **Agentic 能力** —— 读文件、改代码、跑命令，走真实 agent 循环（思考 → 调工具 → 观察 → 再想），**模型原生 `tool_calls`**（工具结果以 `role:tool` 消息回喂），最多 12 步收敛到 `finish`。危险动作前先征求确认。
- ⌨️ **顺手的输入侧** —— slash 命令 Tab 补全、`@文件` 引用（把文件内容作独立上下文块注入）、多行输入（反斜杠续行 `\` + 三引号块 `"""`）。
- 🎛️ **服务商选择向导** —— `setup` 里选一家（DeepSeek / OpenAI / Kimi / 通义 / 智谱 / Ollama / 自定义），自动带出 baseURL；模型可**从内置目录直接选**（不依赖 key、不联网），填了 key 再用真实 `/v1/models` 列表**叠加校准**。
- 🔑 **多 key 管理** —— 一人多把 key（个人号 / 工作号 / 不同服务商）随时切换：`bennira key list | add | use | remove`，脱敏展示、只存本地。旧单 key 配置**无痛升级**。
- 🎨 **八方旅人职业配色** —— 一代开放盗贼紫（其余职业锁定、后续版本开放），真彩色终端 + **白底自动切浅色盘** + CJK 宽度对齐。
- 🔒 **谨慎的安全边界** —— 凭证只存本地、绝不入库；网络 / 执行默认关闭；写入默认需确认；路径锁死在项目根内。
- 📦 **零运行时依赖** —— 纯 Node.js ESM（`.mjs`），无任何第三方 SDK。

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

> **提示**：`npm link` 请用你终端里日常使用的那个 Node（例如 nvm 的 v20），否则 `bennira` 可能被装到不在 PATH 里的目录。全局 `bennira` 是指向源码的软链，**改代码即时生效，无需重新 link**。

之后在任意目录：

```bash
bennira setup      # 首次设置向导
bennira status     # 查看状态
bennira            # 进入交互 REPL
```

> 不想全局注册也行，直接 `node ./packages/cli/src/index.mjs <命令>`。

### 首次设置

```bash
bennira setup
```

向导分三步，**有限选项走方向键菜单（↑↓ / 数字直选 / Enter 确认）**，自由文本才需要打字：

| 步骤 | 交互方式 | 说明 |
|---|---|---|
| ① 配置作用域 | 菜单 | `global`（所有项目共享）/ `project`（仅当前目录） |
| ② 模型接入 | 菜单 + 文本 | **选一家服务商** → 自动带出 baseURL（回车即用）→ **从内置模型目录直接选**（填了 key 会用真实列表叠加校准）→ key 可留空、稍后 `bennira key add` |
| ③ 联网权限 | 菜单 | `deny`（默认，谨慎）/ `allow`（调云端模型需要） |

② 内置服务商预设：**DeepSeek**（默认第一）、OpenAI、Kimi（Moonshot）、通义千问（Qwen）、智谱（GLM）、Ollama（本地）、自定义。选「自定义」才需要手填 baseURL。

> **模型列表怎么来的？两种策略叠加。**
> - **策略一 · 内置目录**：每家服务商编译进工具一份精选模型清单，**不依赖 key、不联网**——选完服务商那一刻就能弹菜单挑。它回答「工具支持接哪些」。
> - **策略二 · 实时拉取**：填了 key 后调 `GET /v1/models`（除本地 Ollama 外都要 key），把结果与内置目录**合并去重**校准。它回答「你的 key 有权访问哪些」。
>
> 所以 key **不再是选模型的前提**：没 key 也能从内置目录选；有 key 只是锦上添花。实时拉取失败（无 key / 断网 / 服务不支持）会静默保留内置目录，只有 custom（无内置目录）且拉取失败时才退回手动输入。
>
> **配色不在 setup 里问**：主题是纯审美偏好，不占用 onboarding。一代默认盗贼紫，想换事后用 `bennira theme use <id>`（一代仅开放盗贼，其余职业为后续版本预留）。终端为白底时会自动切换到浅色适配盘，避免一片灰看不清。

> **凭证安全**：key 只写入 `.bennira/secrets.json`（`chmod 600`），绝不进 `config.json`、绝不入库。在 project 作用域配 key 时会**自动**把 `secrets.json` 加进 `.gitignore`。也可用环境变量 `BENNIRA_API_KEY` 注入（CI / 生产推荐）。
>
> **多 key**：支持存多把 key 并随时切换。`bennira key list` 脱敏列出、`bennira key add <key> --label 工作号 --provider openai` 新增、`bennira key use <id>` 切换激活、`bennira key remove <id>` 删除（加 `--scope project` 操作项目层）。解析优先级：环境变量 → 项目层激活 key → 全局层激活 key。旧的单 key `secrets.json` 会被自动识别为一把「默认」key，无需迁移。

配好后 `bennira status` 显示「✓ 已就绪」即可开始。

> 全程非交互也支持：`printf 'project\ndeepseek\n\n\ndeepseek-chat\ndeny\n' | bennira setup`（管道 / CI 场景自动降级为逐行读取，绝不挂起）。

---

## 命令一览

| 命令 | 需要模型 | 作用 |
|---|---|---|
| `bennira`（裸命令）| ✓ | 进入交互式 REPL 会话（默认命令） |
| `setup` | ✗ | 首次设置：作用域 / 模型接入（内置目录选模型 + key 叠加校准）/ 网络权限 |
| `inspect [path]` | ✗ | 观察项目结构、Git 状态、关键文档 |
| `init [path]` | ✓ | 读懂项目并生成 / 更新 `AGENTS.md` |
| `status [path]` | ✗ | 查看 Bennira 与模型状态（支持 `--json`） |
| `plan "中文想法"` | ✓ | 结合项目状态生成下一步计划（支持 `--no-write`） |
| `log [--limit N]` | ✗ | 查看最近事件日志 |
| `handoff` | ✗ | 刷新 `docs/HANDOFF.md` 跨工具交接文档 |
| `theme [list\|show\|use\|set\|reset]` | ✗ | 查看 / 切换 / 自定义配色 |
| `key [list\|add\|use\|remove]` | ✗ | 管理多把模型 API key（切换激活 / 增删，`--scope` 选层级） |

> 追加 `--no-color` 或设置 `NO_COLOR` 可强制纯文本输出。

---

## REPL 里能做什么

进入 `bennira` 后，用自然中文说话即可：

```
你 › 帮我看看 packages/core 里都有什么
你 › 参考 @packages/core/src/model.mjs，给它补一段错误处理    # @文件引用
你 › 给 README 加一段安装说明                                  # 写文件前会问你 y/N
你 › 跑一下测试                                                # 执行命令前会问你 y/N
```

**内置 slash 命令**（支持 Tab 补全）：

| 命令 | 作用 |
|---|---|
| `/help`（`?`）| 显示帮助 |
| `/status` | 当前模型 / 权限就绪状态 |
| `/init` | 流式生成 / 更新 `AGENTS.md` |
| `/plan <想法>` | 流式生成下一步计划 |
| `/clear` | 清屏并重置会话上下文 |
| `/exit`（`quit` / `q`）| 退出 REPL |

**输入侧技巧**：

- **`@文件` 引用** —— 行首或空白后写 `@path`，提交时把该文件内容作为独立上下文块喂给模型；`@` 正在敲时按 Tab 补全项目内文件路径（含空格的路径自动加引号 `@"a b/c.txt"`）。邮箱 `a@b.com` 不会被误判。
- **多行输入** —— 行尾单个反斜杠 `\` 续行；或单独一行 `"""` 进入三引号块、再一行 `"""` 结束（块内原样保留，适合粘贴大段代码）。
- **Ctrl+C** —— 打断当前正在跑的这一轮（模型输出或工具循环），回到提示符，不退出进程；连按可退出。
- **历史持久化** —— 输入历史落在 `~/.bennira/repl_history`，跨会话、跨项目共享，↑↓ 翻阅。

**安全保障**：改文件、跑命令前一律先征求确认；路径锁死在项目根内，防 `../` 逃逸；每个动作都写入事件日志。

---

## 架构

Monorepo，两个包，**决策与执行边界干净劈开**：

- **`@bennira/core`** —— 纯逻辑内核（**决策侧 + 可测纯函数**）：模型 provider（`generate` / `generateStream`，带外部中断信号）、agent 协议（`buildAgentMessages` / `parseAgentAction`）、配置分层、凭证隔离、主题系统、事件日志、REPL 输入侧纯逻辑（补全 / 多行 / @引用）、零依赖交互组件（方向键菜单）。**零依赖、可离线单测。**
- **`@bennira/cli`** —— 命令行外壳（**执行侧 + 交互**）：REPL、setup 向导、命令路由、`executeTool`（真正的 fs 读写 / 命令执行）与确认交互。唯一依赖 `@bennira/core`。

**核心闭环**：模型走 provider 原生 `tool_calls` 请求工具（决策）→ cli 的 `executeTool` 落地执行（fs / exec）→ 观察结果以 `role:tool` 消息 `history.push` 回喂 → 再次进入模型，循环至 `finish`（`MAX_STEPS=12`）。这条 history 回喂就是 agentic 的本质。（无原生 tool_calls 的模型自动回退到 JSON `{thought, action, args}` 协议。）

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 目录速览

```
Bennira/
├── packages/
│   ├── core/                 @bennira/core（零依赖内核）
│   │   ├── src/
│   │   │   ├── model.mjs         provider / 流式 / 中断 / 服务商预设 + 内置模型目录
│   │   │   ├── agent.mjs         ReAct 工具协议与解析
│   │   │   ├── context.mjs       项目快照 / init / plan 消息构建
│   │   │   ├── prompt.mjs        方向键菜单 / 文本输入（零依赖）
│   │   │   ├── repl-support.mjs  slash 命令 / 补全 / 历史（纯函数）
│   │   │   ├── input-support.mjs 多行输入 / @文件引用（纯函数）
│   │   │   ├── memory.mjs        配置分层读写 / 项目记忆
│   │   │   ├── scope.mjs         全局/项目作用域与路径
│   │   │   ├── secrets.mjs       凭证隔离 + 多 key 管理（secrets.json, chmod 600）
│   │   │   ├── theme.mjs         八职业配色 / CJK 宽度
│   │   │   ├── workspace.mjs     项目观察（git / 文件树 / 文档）
│   │   │   ├── events.mjs        JSONL 事件日志
│   │   │   ├── format.mjs        终端渲染
│   │   │   ├── spinner.mjs       零依赖加载动画
│   │   │   ├── handoff.mjs       生成 docs/HANDOFF.md
│   │   │   └── index.mjs         统一导出面
│   │   └── test/                 15 个测试文件，173 用例
│   └── cli/
│       ├── src/
│       │   ├── index.mjs         子命令路由 + setup 向导
│       │   └── repl.mjs          交互式 REPL + executeTool（原生 tool_calls 回喂）
│       └── test/                 agent-loop.test.mjs（fake-provider 回归网，10 用例）
└── docs/                     产品定义 / 架构 / 路线图等
```

---

## 开发

```bash
npm test              # 运行全部单测（node:test，零依赖，无需 API key）
npm run test:smoke    # 无 key 冒烟测试：验证只读命令能启动
```

**当前测试规模：183 用例全绿**（core 173 + cli 10），全部离线、不需要真实 key——测的是纯逻辑（配置合并、凭证优先级、多 key CRUD / 向后兼容、plan 解析、主题降级 / 背景探测 / 职业锁定、内置模型目录 / 合并 / 拉取解析、gitignore 保护、方向键解码、服务商预设、中断语义、slash 补全 / 历史、@引用与多行输入）以及 cli 侧 agent 循环回归（fake-provider 注入，验证原生 tool_calls → `role:tool` 回喂）。CI 在无 key 环境下也能全绿。

> ⚠️ 跑测试请用无参 `node --test`（即 `npm test`）。Node 22 下 `node --test <目录>` 会把目录当模块加载而报错。

测试文件一览：

| 文件 | 覆盖 |
|---|---|
| `abort.test.mjs` | `UserAbortError` 与预中断 signal 语义 |
| `agent.test.mjs` | `parseAgentAction` / 工具风险 / 消息组装 |
| `config-layering.test.mjs` | 配置分层合并、apiKey 不落 config |
| `ensure-gitignore.test.mjs` | secrets 排除幂等 |
| `plan-and-model.test.mjs` | 计划解析 + 权限门 |
| `prompt.test.mjs` | `decodeKey` / 非 TTY 惰性降级 |
| `provider-presets.test.mjs` | 服务商预设表结构 |
| `repl-support.test.mjs` | slash 补全 / 历史归一 |
| `input-support.test.mjs` | @引用提取 / 补全 / 多行状态机 |
| `secrets.test.mjs` | 凭证来源优先级 |
| `multi-key.test.mjs` | 多 key CRUD / 激活切换 / 旧结构升级 / 内置目录 / 合并去重 / 脱敏 |
| `spinner.test.mjs` | 静默降级 |
| `theme.test.mjs` | 配色降级 / 解析 / CJK 宽度 |
| `background-detect.test.mjs` | OSC 11 终端背景色查询解析 / 明暗判定 |
| `setup-support.test.mjs` | 模型列表拉取解析 / 职业锁定 / 背景探测 / 浅色盘 / 菜单禁用项 |
| `cli/agent-loop.test.mjs` | fake-provider 回归网：agent 循环、原生 `tool_calls` → `role:tool` 回喂、`runAgentTurn` provider 注入 |

---

## 数据落盘

| 位置 | 内容 |
|---|---|
| `~/.bennira/`（可被 `BENNIRA_HOME` 覆盖）| 全局 `config.json` / `secrets.json` / `repl_history` |
| `<project>/.bennira/` | 项目层 `config.json` / `secrets.json` / `state.json` / `logs/events.jsonl` / `last-plan.md` |
| `<project>/docs/HANDOFF.md` | 跨工具交接文档 |

**密钥来源优先级**：环境变量（`BENNIRA_API_KEY` / `OPENAI_API_KEY`）→ 项目 `secrets.json` → 全局 `secrets.json`。

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
- [x] 真流式输出 + Spinner + 交互式 REPL
- [x] 突破只读：agentic 改文件 / 跑命令（带确认）
- [x] 执行体验：Ctrl+C 中断、`/init` `/plan`、Tab 补全、历史持久化
- [x] 输入体验：多行输入、`@文件` 引用、服务商选择向导
- [x] 模型选择：内置模型目录（零 key 可选）+ 实时拉取叠加校准
- [x] 多 key 管理：`bennira key` 增删切换、脱敏、旧结构无痛升级
- [ ] 更细粒度的权限门与 diff 预览
- [ ] MCP / 插件加载
- [ ] 多 Agent 协作

详见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 贡献

欢迎 issue 与 PR。提交前请跑 `npm test` 确保全绿。

## 许可证

[MIT](./LICENSE) © 2026 BreetyGreen
