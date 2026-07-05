# 执行清单 · 原生 tool_calls 改造

> 目标：把工具调用协议从「模型吐 JSON 文本 + 正则解析」升级为 OpenAI 原生 `tool_calls`，
> 作为后续 `apply_patch`、审批粒度升级的地基。
>
> 原则：**严格超集，零回归** —— 支持 `tools` 的 provider 走原生（稳），不支持的回退现有 `parseAgentAction`。
>
> 状态图例：`[ ]` 待做 · `[~]` 进行中 · `[x]` 已完成

---

## 为什么先做这个（决策依据）

- `parseAgentAction`（`agent.mjs:71-78`）在模型输出非干净 JSON 时**静默兜底为 finish**——
  该调 `write_file` 的动作被当成最终答复吐给用户，agent 无声「放弃」还不报错。这是正确性 bug。
- `apply_patch` 的 args 是一段 diff。建在 text-JSON 上要在 JSON 字符串里二次转义（双重转义地狱）；
  建在 `tool_calls` 上，args 是结构化对象，端点直接校验。**所以 tool_calls 是 apply_patch 的地基。**
- 改动局部：`model.mjs` 请求体加 `tools`、响应读 `tool_calls`；`repl.mjs` 回喂改 `role:"tool"`。

---

## 子任务清单

### 阶段 0 · 回归网（动手前提，非可选）

- [x] **T1 · 搭 fake-provider 测试骨架** ✅ 2026-07-06
  - 让 `runAgentTurn` 可注入 provider（依赖倒置），避免测试真联网。
  - 喂一组 canned 响应（先按现有 text-JSON 形态），断言 loop round-trip：
    思考 → 执行工具 → 观察回喂 → finish。
  - 覆盖：safe 工具直接执行、danger 工具经审批、finish 收尾、达 MAX_STEPS 触顶。
  - **必须在当前（未改造）代码上先跑绿**——这是改 model/repl 前的回归网。
  - 顺带补上 `packages/cli` 零测试的盲区。
  - 文件：`packages/cli/test/agent-loop.test.mjs`（新建）
  - **落地**：`runAgentTurn` 改为 `export` 且 `provider` 走默认参数（生产不传=零行为变化，测试传 fake=注入）。
    6 用例：单步 finish / read_file round-trip / search round-trip / write_file 同意即写 /
    write_file 拒绝不写且回喂拒绝观察 / 非 JSON 兜底 finish。**173 全绿（167+6）**。

### 阶段 1 · 核心改造

- [x] **T2 · `model.mjs` 加 `tools` + 读 `tool_calls`** ✅ 2026-07-06
  - `generate` / `generateStream` 请求体加 `tools:[...]`（由 `AGENT_TOOLS` 生成 JSON Schema）。
  - 响应优先读 `choices[0].message.tool_calls`；缺失则回退读 `content`（现有路径）。
  - 新增把 `AGENT_TOOLS` → OpenAI function schema 的转换（`toolSchemas()`）。
  - `parseAgentAction` **保留不删**，作为 fallback。
  - 文件：`packages/core/src/model.mjs`、`packages/core/src/agent.mjs`
  - **落地（严格「只加不改」，对 repl 透明）**：
    - `agent.mjs`：每个工具补 `params`（JSON Schema）；新增 `toolSchemas()`（→ OpenAI
      `tools:[...]`）与 `actionFromToolCall()`（tool_call → 与 parseAgentAction 同形状的动作，
      带 `toolCallId` 供 T3 回喂配对；**坏 JSON 不静默当 finish**，保留空 args+raw）。
    - `model.mjs`：**新增并行方法** `generateWithTools(messages, tools, opts)` → `{ text,
      toolCalls, finishReason }`。老 `generate`/`generateStream` **一字未动**（5 个调用者零影响）。
      空 tools 不发 `tool_choice`；不支持的 provider 回空 toolCalls，上层据此回退。
    - `index.mjs`：导出 `toolSchemas` / `actionFromToolCall`。
    - 新增 6 单测（toolSchemas×2 + actionFromToolCall×4），**179 全绿（173+6）**。切换 loop 去用
      新方法留给 T3。

- [ ] **T3 · `repl.mjs` loop 改 `role:"tool"` 回喂**
  - 拿到 `tool_calls` 时：assistant 消息带 `tool_calls`，观察以 `role:"tool"` + `tool_call_id` 回喂。
  - 无 `tool_calls`（fallback 路径）时：仍走旧的 `role:"user"` + `[观察]` 前缀。
  - 文件：`packages/cli/src/repl.mjs`

### 阶段 2 · 收尾验证

- [ ] **T4 · 全量回归**
  - `node --test` 全绿（现 167 + 新增）。
  - 用 fake-provider 分别验「原生 tool_calls 路径」与「fallback 路径」都能闭环。
  - 更新 `AGENTS.md`（当前已过时：仍写「尚无可运行代码」）。

---

## 进度日志

- 2026-07-06：清单建立，全部待做，提交入库。后续每完成一项，回来勾选并追加一行。
- 2026-07-06：**T1 完成**。`packages/cli` 首个测试文件落地，6 用例锚定改造前 loop 契约，173 全绿。
  provider 依赖注入就绪，改 model/repl 的回归网已织好。
- 2026-07-06：**T2 完成**。core 侧「只加不改」落地原生 tool_calls 能力：`toolSchemas()` /
  `actionFromToolCall()` / `generateWithTools()`，老方法零改动、对 repl 透明，179 全绿（173+6）。
  下一步 T3 把 agent loop 切到新方法并改 role:"tool" 回喂。
