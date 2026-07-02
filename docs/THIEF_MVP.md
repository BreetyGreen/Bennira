# Bennira 一代 - 小偷 MVP

## 版本定位

`Bennira 一代 - 小偷` 是 Bennira 的第一个大版本。

这个版本的目标不是做完整 Codex 或 Claude Code，而是验证 Bennira 的核心路线：

> 一个中文优先、可解释、可恢复、会观察项目并能小步行动的本地代码 Agent。

“小偷”的产品隐喻是：

- 轻量进入。
- 先观察。
- 找线索。
- 小步行动。
- 不破坏现场。
- 留下清楚记录。

## 阶段拆分

当前版本需要拆成两个层次，避免第一步就过大。

### 小偷 Alpha

Alpha 只验证一件事：

> Bennira 能不能把一个模糊中文想法，整理成可恢复、可继续的项目状态。

Alpha 不要求真正修改业务代码。

### 小偷 MVP

MVP 在 Alpha 成立后，再验证第二件事：

> Bennira 能不能基于项目状态，完成一次小步文件修改，并留下可解释的行动记录。

## Alpha 成功标准

Alpha 成功，不是指功能多，而是指能跑通这个最小闭环：

1. 用户在一个项目目录中启动 Bennira。
2. Bennira 读取项目规则和已有文档。
3. 用户输入一个中文模糊想法。
4. Bennira 生成或更新产品定义、MVP、路线图等项目文档。
5. Bennira 输出下一步任务。
6. Bennira 写入事件日志。
7. 用户换会话后，Bennira 能根据仓库文档恢复项目状态。

## MVP 成功标准

第一版成功，不是指功能多，而是指能完整跑通一个最小闭环：

1. 用户在一个项目目录中启动 Bennira。
2. Bennira 读取项目规则和文档。
3. 用户输入一个中文需求。
4. Bennira 先澄清或计划。
5. Bennira 搜索和读取相关文件。
6. Bennira 提出小步修改方案。
7. 用户确认后应用 patch。
8. Bennira 运行可用的验证命令。
9. Bennira 总结修改、验证结果和下一步。
10. 所有关键行动写入事件日志。

## 第一版用户故事

### 需求澄清

用户输入一个模糊想法：

```text
我想做一个类似 Codex 的工具，但是有自己的特色。
```

Bennira 应该能：

- 追问目标用户。
- 拆解问题。
- 生成定位文档。
- 生成 MVP 文档。
- 标出暂不做范围。

### 项目观察

用户在项目根目录运行 Bennira。

Bennira 应该能：

- 识别项目文件。
- 读取 `README.md`。
- 读取 `AGENTS.md`。
- 读取 `docs/` 核心文件。
- 总结项目当前状态。

### 小步修改

用户要求：

```text
帮我新增一个产品定位文档。
```

Bennira 应该能：

- 查找已有文档。
- 判断应该新增还是修改。
- 生成 patch。
- 请求确认。
- 应用修改。
- 总结变更。

### 验证闭环

如果项目有测试命令，Bennira 应该能建议或运行。

如果没有测试命令，Bennira 应该说明：

- 没有发现验证命令。
- 本次只能做文档/静态检查。
- 后续应补充测试或 lint。

## 第一版功能范围

### Alpha 必须做

- CLI 入口。
- 工作区识别。
- 文件树扫描。
- 文件读取。
- 文本搜索。
- 项目规则读取。
- 中文对话。
- 计划生成。
- 事件日志。
- 基础配置文件。
- 项目文档生成或更新。
- 会话恢复摘要。

### MVP 必须做

- patch 生成。
- patch 应用。
- Git status。
- Git diff。
- 命令执行。
- 权限确认。
- 读取 `README.md`、`AGENTS.md`、`docs/` 的优先级策略。
- 默认拒绝读取敏感文件。
- 命令执行前展示命令和风险。
- 修改文件前展示摘要。
- 任务结束时写入总结。
- 支持中断后查看上一轮日志。

### 应该做

- 自动发现测试命令。
- 根据项目类型推荐验证命令。
- 简单 repo map。

### 可以做

- 简单 TUI。
- 本地模型适配。

### 暂不做

- 完整桌面端。
- Web UI。
- IDE 插件。
- 云端任务。
- 多用户协作。
- 企业权限系统。
- 插件市场。
- 多 Agent 并行。
- 自动 PR。
- 自动推送。
- 长期后台任务。

## 第一版核心命令设想

```bash
bennira
bennira ask "帮我理解这个项目"
bennira inspect
bennira plan "新增登录功能"
bennira edit "更新 README"
bennira status
bennira log
```

Alpha 阶段优先实现：

```bash
bennira inspect
bennira plan "我想做一个类似 Codex 但有自己特色的产品"
bennira status
bennira log
```

`edit` 可以等到 MVP 阶段再实现。

## 第一版配置设想

项目配置文件：

```text
.bennira/config.json
```

可能内容：

```json
{
  "language": "zh-CN",
  "versionLine": "小偷",
  "defaultMode": "plan-first",
  "permissions": {
    "read": "allow",
    "write": "confirm",
    "execute": "confirm",
    "network": "deny"
  },
  "sensitivePatterns": [
    ".env",
    ".env.*",
    "secrets/**",
    "*.pem",
    "*.key"
  ]
}
```

## 第一版事件日志设想

日志目录：

```text
.bennira/logs/
```

日志格式：

```json
{"time":"2026-07-01T00:00:00Z","type":"user_message","summary":"用户要求新增产品定位文档"}
{"time":"2026-07-01T00:00:03Z","type":"read_file","path":"README.md","success":true}
{"time":"2026-07-01T00:00:10Z","type":"propose_patch","files":["docs/POSITIONING.md"],"requiresApproval":true}
{"time":"2026-07-01T00:00:20Z","type":"apply_patch","files":["docs/POSITIONING.md"],"success":true}
```

## 第一版内核接口草案

```ts
type ToolRisk = "low" | "medium" | "high";

type ToolDefinition = {
  name: string;
  description: string;
  risk: ToolRisk;
  requiresApproval: boolean;
  inputSchema: unknown;
  run(input: unknown, context: RunContext): Promise<ToolResult>;
};

type ToolResult = {
  success: boolean;
  summary: string;
  data?: unknown;
  error?: string;
};
```

## 第一版技术建议

建议用 TypeScript 开始。

原因：

- 容易写 CLI。
- 容易定义工具 schema。
- 容易接模型 API。
- 未来能复用到桌面端或 Web。
- 生态中有成熟的文件、Git、子进程、TUI 库。

## 下一阶段候选版本

如果“小偷”版本完成，后续可以考虑：

- `学者`：强化代码理解、repo map、符号索引和文档检索。
- `商人`：强化插件市场、成本控制、模型路由。
- `药师`：强化错误诊断、测试修复、项目健康检查。
- `猎人`：强化 bug 捕获、日志分析、异常追踪。
- `发明家`：引入多 Agent、自动化工作流和自定义工具构建。
