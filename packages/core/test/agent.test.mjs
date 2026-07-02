import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentAction,
  buildAgentMessages,
  AGENT_TOOL_RISK,
  AGENT_TOOLS,
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
