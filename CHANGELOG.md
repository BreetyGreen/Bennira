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
- `ensureSecretsIgnored()`: setup now auto-writes `.gitignore` protection for `secrets.json`. / setup 现在自动为 `secrets.json` 写入 `.gitignore` 保护。
- Bilingual README (`README.md` / `README.en.md`), MIT LICENSE, CONTRIBUTING. / 双语 README、MIT 许可证、贡献指南。

### Changed / 变更
- Removed the "read-only boundary" wording from prompts and help. / 从 prompt 与 help 中移除「只读边界」措辞。
- README rewritten to reflect real capabilities (REPL / streaming / agentic). / README 重写以反映真实能力。

### Fixed / 修复
- setup no longer only warns about an unprotected `.gitignore`; it now fixes it automatically (idempotent). / setup 不再只警告 `.gitignore` 未保护，而是自动修复（幂等）。

## [0.1.0-alpha.0] - 2026-07

### Added / 新增
- Thief Alpha CLI: `setup` / `inspect` / `init` / `status` / `plan` / `log` / `handoff` / `theme`. / 小偷 Alpha CLI 的 8 个命令。
- Layered config (global + project), credential isolation, network permission gate. / 配置分层、凭证隔离、网络权限门。
- Octopath job themes with truecolor + plain-text fallback. / 八方旅人职业配色，支持真彩色与纯文本降级。
- Zero-dependency `node:test` unit tests. / 零依赖 `node:test` 单测。

[Unreleased]: https://github.com/BreetyGreen/Bennira/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/BreetyGreen/Bennira/releases/tag/v0.1.0-alpha.0
