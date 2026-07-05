// agent-loop.test.mjs —— packages/cli 的首个回归网
// -----------------------------------------------------------------------------
// 背景：core 有 167 测试，但真正动文件 / 跑命令 / 驱动 agentic 循环的 packages/cli
// 一个测试都没有。改造工具调用协议（原生 tool_calls）前，必须先给 runAgentTurn 织一张
// 回归网——否则盲改 loop 无从验证。
//
// 策略（不联网、不需真 key、不污染项目）：
//   1. provider 依赖注入：runAgentTurn 现支持传入 provider，喂 canned 响应即可离线验证。
//   2. root 用真实临时目录：safe 工具（read_file/list_files/search）真跑真读，坐实 round-trip。
//   3. theme 用 plain 模式（enabled:false）：paint 恒等、streamFinish 一次性打印不 sleep。
//   4. rl 用 fake：question() 自动应答 y/N，驱动 danger 工具的审批分支，不读真 stdin。
//
// 这些测试锚定「改造前」的行为契约。改 model.mjs / repl.mjs 后重跑，必须仍绿。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTheme } from "@bennira/core";
import { runAgentTurn } from "../src/repl.mjs";

// ---- 测试替身 --------------------------------------------------------------

// Fake provider：按预设脚本逐步返回。每次 generate 吐出脚本里的下一条（当前为
// text-JSON 形态，与改造前的 parseAgentAction 契约一致）。脚本耗尽即报错，
// 避免死循环悄悄跑满 MAX_STEPS。
function scriptedProvider(responses) {
  let i = 0;
  return {
    calls: 0,
    async generate() {
      this.calls += 1;
      if (i >= responses.length) {
        throw new Error(`scriptedProvider 脚本已耗尽（第 ${i + 1} 次调用无对应响应）`);
      }
      return responses[i++];
    },
    // streamFinish 在 enabled:false 时不调 provider，但保留以防未来路径变化。
    async generateStream(_messages, onToken = () => {}) {
      const text = await this.generate();
      onToken(text);
      return text;
    },
  };
}

// Fake readline：question 自动用预设答案回应确认框；records 记录被问过的问题。
function fakeReadline(answer = "y") {
  return {
    questions: [],
    on() {},
    off() {},
    question(q, cb) {
      this.questions.push(q);
      cb(answer);
    },
  };
}

// Native fake provider：暴露 generateWithTools，按脚本返回结构化 { text, toolCalls }。
// 每条脚本项形如 { toolCalls:[{id,function:{name,arguments}}] } 或 { text }（无工具=交付）。
// 用来验证 T3 的原生通道：结构化 tool_calls → role:"tool" 回喂配对。
function nativeProvider(script) {
  let i = 0;
  return {
    calls: 0,
    toolCallsSeen: [],
    async generateWithTools(_messages, _tools) {
      this.calls += 1;
      if (i >= script.length) {
        throw new Error(`nativeProvider 脚本已耗尽（第 ${i + 1} 次调用无对应响应）`);
      }
      const item = script[i++];
      const toolCalls = Array.isArray(item.toolCalls) ? item.toolCalls : [];
      return { text: item.text || "", toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop" };
    },
    // finish 分支的 streamFinish 在 enabled:false 时不调 provider，保留兜底。
    async generateStream(_messages, onToken = () => {}) {
      onToken("");
      return "";
    },
  };
}

// 构造一个结构化 tool_call（OpenAI 形状：arguments 是 JSON 字符串）。
function toolCall(id, name, argsObj) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(argsObj) } };
}

// 造一个真实的临时项目根，放几个可读文件。返回 { root, cleanup }。
function makeTempProject() {
  const root = mkdtempSync(join(tmpdir(), "bennira-loop-"));
  writeFileSync(join(root, "README.md"), "# 临时项目\n用于测试 agent 循环。\n关键字ALPHA在这里。\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.mjs"), "export const a = 1;\n", "utf8");
  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// plain 主题：所有 paint 恒等，enabled:false 让 streamFinish 一次性打印不 sleep。
function plainTheme() {
  return createTheme({}, { enabled: false });
}

// 统一构造 runAgentTurn 的入参。history 默认空，provider 必传（fake）。
function runOpts({ root, provider, history = [], userInput = "帮我做点事", rl = fakeReadline("y") }) {
  return { root, config: {}, t: plainTheme(), rl, history, userInput, provider };
}

// ---- 用例 ------------------------------------------------------------------

test("loop: 单步 finish —— 模型直接交付，不调工具", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = scriptedProvider([
      '{"thought":"直接答","action":"finish","args":{"message":"这是最终答复"}}',
    ]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    // 循环只该调一次模型
    assert.equal(provider.calls, 1);
    // history 末尾应是 assistant 的 finish 响应；user 输入在前
    assert.equal(history[0].role, "user");
    assert.equal(history[0].content, "帮我做点事");
    assert.equal(history[1].role, "assistant");
    assert.ok(history[1].content.includes("最终答复"));
  } finally {
    cleanup();
  }
});

test("loop: safe 工具 round-trip —— read_file 真读文件并把观察回喂", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = scriptedProvider([
      '{"thought":"先读 README","action":"read_file","args":{"path":"README.md"}}',
      '{"thought":"读到了","action":"finish","args":{"message":"README 已读"}}',
    ]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    assert.equal(provider.calls, 2);
    // 观察必须以 role:"user" + [观察] 前缀回喂（改造前契约），且含真实文件内容
    const observation = history.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("[观察]")
    );
    assert.ok(observation, "应存在一条 [观察] 回喂消息");
    assert.ok(observation.content.includes("关键字ALPHA"), "观察应含被读文件的真实内容");
  } finally {
    cleanup();
  }
});

test("loop: search 工具 round-trip —— 命中并回喂", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = scriptedProvider([
      '{"thought":"搜一下","action":"search","args":{"query":"关键字ALPHA"}}',
      '{"thought":"找到了","action":"finish","args":{"message":"搜索完成"}}',
    ]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    const observation = history.find(
      (m) => m.role === "user" && m.content.startsWith("[观察]")
    );
    assert.ok(observation, "search 应回喂观察");
    assert.ok(/README\.md|命中/.test(observation.content), "搜索观察应提到命中文件或命中信息");
  } finally {
    cleanup();
  }
});

test("loop: danger 工具经审批 —— 同意则真写文件", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = scriptedProvider([
      '{"thought":"写个文件","action":"write_file","args":{"path":"out.txt","content":"HELLO_BENNIRA"}}',
      '{"thought":"写好了","action":"finish","args":{"message":"已写入"}}',
    ]);
    const rl = fakeReadline("y"); // 用户同意
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history, rl }));
    // 审批框被问过
    assert.ok(rl.questions.length >= 1, "danger 工具应触发一次确认");
    // 文件真被写入
    const written = join(root, "out.txt");
    assert.ok(existsSync(written), "同意后文件应真被写入");
    assert.equal(readFileSync(written, "utf8"), "HELLO_BENNIRA");
  } finally {
    cleanup();
  }
});

test("loop: danger 工具被拒 —— 不写文件，拒绝观察回喂给模型", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = scriptedProvider([
      '{"thought":"想写文件","action":"write_file","args":{"path":"nope.txt","content":"X"}}',
      '{"thought":"那就算了","action":"finish","args":{"message":"好的不写了"}}',
    ]);
    const rl = fakeReadline("n"); // 用户拒绝
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history, rl }));
    // 文件不该存在
    assert.ok(!existsSync(join(root, "nope.txt")), "拒绝后不应写文件");
    // 拒绝观察应回喂
    const denial = history.find(
      (m) => m.role === "user" && m.content.includes("拒绝")
    );
    assert.ok(denial, "拒绝应作为观察回喂给模型");
  } finally {
    cleanup();
  }
});

test("loop: 非 JSON 输出 —— 经 parseAgentAction 兜底为 finish 交付", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    // 模型没按格式，吐了一段普通文本。当前契约：兜底当作 finish。
    const provider = scriptedProvider(["我觉得这个项目挺好的，没什么要改的。"]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    assert.equal(provider.calls, 1, "兜底为 finish，只调一次模型");
    // 不应有任何 [观察]（没执行工具）
    const hasObservation = history.some((m) => m.role === "user" && m.content.startsWith("[观察]"));
    assert.ok(!hasObservation, "兜底路径不该执行工具");
  } finally {
    cleanup();
  }
});

// ---- T3：原生 tool_calls 通道 ----------------------------------------------
// 上面 6 个用例的 provider 只有 generate（无 generateWithTools），故走老路 fallback，
// 锚定的是"改造前"契约。下面的 provider 暴露 generateWithTools，验证 T3 新增的原生通道：
// 结构化 tool_calls → 执行工具 → 观察以 role:"tool" + tool_call_id 配对回喂。

test("原生: read_file round-trip —— 结构化 tool_calls 且观察走 role:tool 回喂", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = nativeProvider([
      { toolCalls: [toolCall("call_1", "read_file", { path: "README.md" })] },
      { text: "README 已读" }, // 无 tool_calls = 交付
    ]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    assert.equal(provider.calls, 2, "两步：读 + 交付");
    // 关键：观察必须以 role:"tool" + 正确的 tool_call_id 回喂（OpenAI 规范），不再是 [观察] 前缀
    const toolMsg = history.find((m) => m.role === "tool");
    assert.ok(toolMsg, "原生通道应产生一条 role:tool 消息");
    assert.equal(toolMsg.tool_call_id, "call_1", "tool_call_id 必须与 tool_calls[0].id 配对");
    assert.ok(toolMsg.content.includes("关键字ALPHA"), "role:tool 内容应含真实文件内容");
    // 且 assistant 回合原样带上了 tool_calls[0]（否则下一轮请求会报错）
    const asstWithCall = history.find((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    assert.ok(asstWithCall, "assistant 回合应携带 tool_calls[0]");
    assert.equal(asstWithCall.tool_calls[0].id, "call_1");
    // 不应再出现老的 [观察] 前缀
    const legacyObs = history.some((m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("[观察]"));
    assert.ok(!legacyObs, "原生通道不应再用 [观察] 前缀回喂");
  } finally {
    cleanup();
  }
});

test("原生: 单步交付 —— 无 tool_calls 只有 text 时当作 finish", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = nativeProvider([{ text: "这是最终答复" }]);
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    assert.equal(provider.calls, 1, "只调一次即交付");
    const asst = history.find((m) => m.role === "assistant");
    assert.ok(asst && asst.content.includes("最终答复"));
    // 交付路径不该有 role:tool
    assert.ok(!history.some((m) => m.role === "tool"), "交付不产生 tool 消息");
  } finally {
    cleanup();
  }
});

test("原生: write_file 经审批 —— 同意后真写且观察以 role:tool 回喂", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    const provider = nativeProvider([
      { toolCalls: [toolCall("call_w", "write_file", { path: "out.txt", content: "HELLO_NATIVE" })] },
      { text: "已写入" },
    ]);
    const rl = fakeReadline("y");
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history, rl }));
    assert.ok(rl.questions.length >= 1, "danger 工具在原生通道仍应触发确认");
    const written = join(root, "out.txt");
    assert.ok(existsSync(written), "同意后文件应真被写入");
    assert.equal(readFileSync(written, "utf8"), "HELLO_NATIVE");
    const toolMsg = history.find((m) => m.role === "tool" && m.tool_call_id === "call_w");
    assert.ok(toolMsg, "写入观察应以 role:tool + call_w 回喂");
  } finally {
    cleanup();
  }
});

test("原生: provider 首次即报错 —— 安全降级到老路，不吞成 finish", async () => {
  const { root, cleanup } = makeTempProject();
  try {
    // 这个 provider 同时有 generateWithTools（首次即抛非硬故障错）和 generate（老路能跑）。
    // 期望：loop 探测原生失败 → 降级 → 用老路 generate 完成交付。
    const legacy = scriptedProvider(['{"action":"finish","args":{"message":"老路交付"}}']);
    const provider = {
      calls: 0,
      async generateWithTools() {
        // 模拟"端点不支持 tools，返回 4xx"这类可降级错误（非 USER_ABORT/NETWORK_DENIED/MODEL_CONFIG）。
        const e = new Error("模型返回 400：unsupported parameter: tools");
        e.code = "MODEL_REQUEST";
        throw e;
      },
      generate: (...a) => legacy.generate(...a),
      generateStream: (...a) => legacy.generateStream(...a),
    };
    const history = [];
    await runAgentTurn(runOpts({ root, provider, history }));
    // 降级后应由老路交付，history 里有老路的 assistant 文本
    const asst = history.find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("老路交付"));
    assert.ok(asst, "原生失败后应安全降级到老路完成交付");
  } finally {
    cleanup();
  }
});
