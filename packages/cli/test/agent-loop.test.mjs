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
