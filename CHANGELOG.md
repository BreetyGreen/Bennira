# Changelog

All notable changes to this project will be documented in this file.
本项目的所有重要变更都会记录在此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added / 新增
- Interactive REPL: bare `bennira` enters a persistent session. / 交互式 REPL：裸命令 `bennira` 进入持久会话。
- Streaming output over OpenAI-compatible SSE (DeepSeek verified). / 基于 OpenAI 兼容 SSE 的流式输出（已用 DeepSeek 验证）。
- Spinner during model thinking, auto-disabled in non-TTY. / 模型思考时的 spinner，非 TTY 自动禁用。
- Agentic loop: read files / edit code / run commands with confirmation. / Agentic 循环：读文件 / 改代码 / 跑命令，带确认。
- **Native model `tool_calls`**: agent loop now uses provider-native `tool_calls`, feeding results back as `role:tool` messages (falls back to JSON protocol when unsupported). / **模型原生 `tool_calls`**：agent 循环改用 provider 原生 `tool_calls`，结果以 `role:tool` 消息回喂（不支持时回退 JSON 协议）。
- CLI `agent-loop.test.mjs`: first cli-side regression net with an injectable fake-provider. / CLI 首个回归网 `agent-loop.test.mjs`，可注入 fake-provider。
- Ctrl+C aborts the current turn (model output or tool loop) without exiting. / Ctrl+C 中断当前轮（模型输出或工具循环）而不退出。
- In-REPL slash commands (`/init`, `/plan`, …) with Tab completion + cross-session history. / REPL 内 slash 命令（`/init`、`/plan` 等）+ Tab 补全 + 跨会话历史。
- Multi-line input (`\` continuation, `"""` blocks) and `@file` references. / 多行输入（`\` 续行、`"""` 块）与 `@文件` 引用。
- Provider-selection wizard with built-in model catalog (usable without a key) + live `/v1/models` merge. / 服务商选择向导：内置模型目录（无 key 可选）+ 实时 `/v1/models` 合并校准。
- Multi-key management: `bennira key list | add | use | remove` with masking and legacy single-key upgrade. / 多 key 管理：`bennira key` 增删切换，脱敏展示、旧单 key 无痛升级。
- Terminal theme adaptation: OSC 11 background probe + color-depth detection (truecolor→256 fallback). / 终端主题自适应：OSC 11 背景探测 + 色彩深度检测（真彩色→256 色降级）。
- `ensureSecretsIgnored()`: setup now auto-writes `.gitignore` protection for `secrets.json`. / setup 现在自动为 `secrets.json` 写入 `.gitignore` 保护。
- Bilingual README (`README.md` / `README.en.md`), MIT LICENSE, CONTRIBUTING. / 双语 README、MIT 许可证、贡献指南。

### Changed / 变更
- Removed the "read-only boundary" wording from prompts and help. / 从 prompt 与 help 中移除「只读边界」措辞。
- README rewritten to reflect real capabilities (REPL / streaming / agentic / native tool_calls). / README 重写以反映真实能力（REPL / 流式 / agentic / 原生 tool_calls）。
- Docs refreshed to current state (HANDOFF / CONTINUITY / ROADMAP), including the `bennira handoff` generator so it no longer bakes in stale status or a misleading "don't run shell / don't edit code" hint. / 文档刷新到当前真实状态（HANDOFF / CONTINUITY / ROADMAP），并修正 `bennira handoff` 生成器，使其不再写死过时状态或「不要执行 shell / 不改代码」的误导提示。
- setup drops the color step; theme is now an optional post-setup preference. / setup 去掉配色步骤，主题改为 setup 后可选。

### Fixed / 修复
- setup no longer only warns about an unprotected `.gitignore`; it now fixes it automatically (idempotent). / setup 不再只警告 `.gitignore` 未保护，而是自动修复（幂等）。
- Truecolor→256 downgrade fixes fully-colorless output on terminals like Terminal.app. / 真彩色→256 降级，修复 Terminal.app 等终端一片无色的问题。
- Menu selection uses inverse-highlight so it stays readable on light backgrounds. / 菜单选中态改为反显高亮，浅色背景下也清晰。

### Tests / 测试
- 183 passing (`node --test`): core 173 (15 files) + cli 10 (1 file). / `node --test` 183 全绿：core 173（15 文件）+ cli 10（1 文件）。

## [0.1.0-alpha.0] - 2026-07

### Added / 新增
- Thief Alpha CLI: `setup` / `inspect` / `init` / `status` / `plan` / `log` / `handoff` / `theme`. / 小偷 Alpha CLI 的 8 个命令。
- Layered config (global + project), credential isolation, network permission gate. / 配置分层、凭证隔离、网络权限门。
- Octopath job themes with truecolor + plain-text fallback. / 八方旅人职业配色，支持真彩色与纯文本降级。
- Zero-dependency `node:test` unit tests. / 零依赖 `node:test` 单测。

[Unreleased]: https://github.com/BreetyGreen/Bennira/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/BreetyGreen/Bennira/releases/tag/v0.1.0-alpha.0
