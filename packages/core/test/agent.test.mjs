import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentAction,
  buildAgentMessages,
  AGENT_TOOL_RISK,
  AGENT_TOOLS,
  toolSchemas,
  actionFromToolCall,
} from "../src/agent.mjs";

test("parseAgentAction: 解析标准 JSON 动作", () => {
  const out = parseAgentAction('{"thought":"看看根目录","action":"list_files","args":{"path":"."}}');
  assert.equal(out.action, "list_files");
  assert.equal(out.args.path, ".");
  assert.equal(out.thought, "看看根目录");
  assert.ok(!out.fellBack);
});

test("parseAgentAction: 容忍 ```json 代码块包裹", () => {
  const wrapped = "```json\n{\"action\":\"read_file\",\"args\":{\"path\":\"README.md\"}}\n```";
  const out = parseAgentAction(wrapped);
  assert.equal(out.action, "read_file");
  assert.equal(out.args.path, "README.md");
});

test("parseAgentAction: 容忍 JSON 前后有解释性杂字", () => {
  const noisy = '好的，我来读取文件：\n{"action":"read_file","args":{"path":"a.txt"}}\n以上。';
  const out = parseAgentAction(noisy);
  assert.equal(out.action, "read_file");
  assert.equal(out.args.path, "a.txt");
});

test("parseAgentAction: 非 JSON 文本兜底为 finish", () => {
  const out = parseAgentAction("这是一段普通回答，没有 JSON。");
  assert.equal(out.action, "finish");
  assert.equal(out.args.message, "这是一段普通回答，没有 JSON。");
  assert.ok(out.fellBack);
});

test("parseAgentAction: args 缺失时归一为空对象", () => {
  const out = parseAgentAction('{"action":"finish"}');
  assert.equal(out.action, "finish");
  assert.deepEqual(out.args, {});
});

test("AGENT_TOOL_RISK: 读类 safe、写/执行 danger", () => {
  assert.equal(AGENT_TOOL_RISK.read_file, "safe");
  assert.equal(AGENT_TOOL_RISK.list_files, "safe");
  assert.equal(AGENT_TOOL_RISK.search, "safe");
  assert.equal(AGENT_TOOL_RISK.finish, "safe");
  assert.equal(AGENT_TOOL_RISK.write_file, "danger");
  assert.equal(AGENT_TOOL_RISK.run_command, "danger");
});

test("AGENT_TOOLS: 每个工具都有 name/risk/desc", () => {
  for (const tool of AGENT_TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.ok(["safe", "danger"].includes(tool.risk));
    assert.ok(tool.desc.length > 0);
  }
});

test("buildAgentMessages: system 含快照，历史原样接在后面", () => {
  const history = [
    { role: "user", content: "帮我看看" },
    { role: "assistant", content: '{"action":"finish","args":{"message":"好"}}' },
  ];
  const msgs = buildAgentMessages("项目快照XYZ", history);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes("项目快照XYZ"));
  assert.ok(msgs[0].content.includes("write_file")); // 工具清单进了 system
  assert.equal(msgs[1].content, "帮我看看");
  assert.equal(msgs.length, 3);
});

// --- T2：原生 tool_calls 支撑函数 ---------------------------------------------

test("toolSchemas: 每项是合法的 OpenAI function schema，且覆盖全部工具", () => {
  const schemas = toolSchemas();
  assert.equal(schemas.length, AGENT_TOOLS.length);
  const names = new Set();
  for (const s of schemas) {
    assert.equal(s.type, "function");
    assert.equal(typeof s.function.name, "string");
    assert.ok(s.function.description.length > 0);
    // parameters 必须是 object 类型的 JSON Schema
    assert.equal(s.function.parameters.type, "object");
    assert.equal(typeof s.function.parameters.properties, "object");
    assert.ok(Array.isArray(s.function.parameters.required));
    names.add(s.function.name);
  }
  // 关键工具都在，名字与 AGENT_TOOLS 一一对应
  for (const t of AGENT_TOOLS) assert.ok(names.has(t.name), `缺少 ${t.name}`);
});

test("toolSchemas: write_file 要求 path 与 content 两个必填参数", () => {
  const wf = toolSchemas().find((s) => s.function.name === "write_file");
  assert.deepEqual(wf.function.parameters.required.sort(), ["content", "path"]);
  assert.equal(wf.function.parameters.properties.path.type, "string");
  assert.equal(wf.function.parameters.properties.content.type, "string");
});

test("actionFromToolCall: 解析标准 tool_call（arguments 是 JSON 字符串）", () => {
  const out = actionFromToolCall({
    id: "call_abc",
    type: "function",
    function: { name: "read_file", arguments: '{"path":"README.md"}' },
  });
  assert.equal(out.action, "read_file");
  assert.equal(out.args.path, "README.md");
  assert.equal(out.toolCallId, "call_abc"); // T3 回喂配对要用
});

test("actionFromToolCall: arguments 为空串归一为空 args（不报错）", () => {
  const out = actionFromToolCall({
    id: "call_x",
    function: { name: "list_files", arguments: "" },
  });
  assert.equal(out.action, "list_files");
  assert.deepEqual(out.args, {});
});

test("actionFromToolCall: arguments 是坏 JSON 时不静默当 finish（保留空 args + raw）", () => {
  const bad = { id: "call_y", function: { name: "write_file", arguments: "{不是合法json" } };
  const out = actionFromToolCall(bad);
  // 关键：action 仍是模型意图的 write_file，不被吞成 finish
  assert.equal(out.action, "write_file");
  assert.deepEqual(out.args, {});
  assert.equal(out.raw, bad); // 上层可据 raw 察觉异常并回喂重试
});

test("actionFromToolCall: 兼容 arguments 直接是对象的实现", () => {
  const out = actionFromToolCall({
    id: "call_z",
    function: { name: "search", arguments: { query: "TODO" } },
  });
  assert.equal(out.action, "search");
  assert.equal(out.args.query, "TODO");
});
