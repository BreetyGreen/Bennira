import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpinner } from "../src/spinner.mjs";

// 一个假的非-TTY 流，记录写入内容。
function fakeStream({ isTTY = false } = {}) {
  const chunks = [];
  return {
    isTTY,
    write: (s) => {
      chunks.push(s);
      return true;
    },
    get output() {
      return chunks.join("");
    },
  };
}

test("非 TTY：spinner 完全静默，start/stop 不写任何动画", () => {
  const stream = fakeStream({ isTTY: false });
  const spin = createSpinner("正在思考…", { stream });
  spin.start();
  spin.stop();
  assert.equal(stream.output, ""); // 管道场景绝不污染输出
  assert.equal(spin.running, false);
});

test("enabled:false 显式禁用：即使 TTY 也静默", () => {
  const stream = fakeStream({ isTTY: true });
  const spin = createSpinner("x", { stream, enabled: false });
  spin.start();
  spin.stop();
  assert.equal(stream.output, "");
});

test("非 TTY succeed(msg)：给一行明确结果而非动画", () => {
  const stream = fakeStream({ isTTY: false });
  const spin = createSpinner("思考", { stream });
  spin.start();
  spin.succeed("完成");
  assert.ok(stream.output.includes("完成"));
});

test("setText 不抛错且可链式", () => {
  const stream = fakeStream({ isTTY: false });
  const spin = createSpinner("a", { stream });
  assert.equal(spin.setText("b"), spin);
});
