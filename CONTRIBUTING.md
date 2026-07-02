# Contributing to Bennira / 贡献指南

Thanks for your interest! / 感谢你的关注！

## Quick rules / 基本约定

- **Node.js >= 20** is required. / 需要 Node.js 20 及以上。
- Keep it **zero runtime dependencies**. Prefer Node built-ins. / 保持**零运行时依赖**，优先用 Node 内置能力。
- Run tests before submitting: / 提交前跑测试：

  ```bash
  npm test
  ```

- All tests must stay **offline and keyless** (no real API key). / 所有测试必须**离线、无需真实 key**。

## Workflow / 流程

1. Fork & branch from `master`. / 从 `master` fork 并建分支。
2. Make focused changes with clear commit messages. / 小步提交，信息清晰。
3. Add / update tests for logic changes. / 逻辑变更请补充或更新测试。
4. Update `CHANGELOG.md` under `[Unreleased]`. / 在 `CHANGELOG.md` 的 `[Unreleased]` 下记录变更。
5. Open a PR; CI must be green. / 提交 PR，CI 需全绿。

## Security / 安全

- Never commit credentials. Keys belong in `.bennira/secrets.json` (gitignored) or `BENNIRA_API_KEY`. / 绝不提交凭证。key 只放 `.bennira/secrets.json`（已 gitignore）或环境变量。
- Report security issues privately rather than in public issues. / 安全问题请私下反馈，勿公开提 issue。
