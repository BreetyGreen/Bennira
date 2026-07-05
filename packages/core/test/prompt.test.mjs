import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeKey, selectMenu, textInput } from "../src/prompt.mjs";

// ── decodeKey：键位解码（无需真终端，纯函数）────────────────────────────────

test("decodeKey：方向键 ↑↓ 解码为 up/down", () => {
  assert.equal(decodeKey("\u001b[A"), "up");
  assert.equal(decodeKey("\u001b[B"), "down");
  // 部分终端用 ESC O A/B
  assert.equal(decodeKey("\u001bOA"), "up");
  assert.equal(decodeKey("\u001bOB"), "down");
});

test("decodeKey：vim 键位 j/k", () => {
  assert.equal(decodeKey("k"), "up");
  assert.equal(decodeKey("j"), "down");
});

test("decodeKey：左右方向键宽容映射为 up/down", () => {
  assert.equal(decodeKey("\u001b[D"), "up");
  assert.equal(decodeKey("\u001b[C"), "down");
});

test("decodeKey：回车 / 换行 → enter", () => {
  assert.equal(decodeKey("\r"), "enter");
  assert.equal(decodeKey("\n"), "enter");
});

test("decodeKey：Ctrl+C / Ctrl+D / ESC / q → cancel", () => {
  assert.equal(decodeKey("\u0003"), "cancel");
  assert.equal(decodeKey("\u0004"), "cancel");
  assert.equal(decodeKey("\u001b"), "cancel");
  assert.equal(decodeKey("q"), "cancel");
});

test("decodeKey：数字 1-9 → digit:n", () => {
  assert.equal(decodeKey("1"), "digit:1");
  assert.equal(decodeKey("9"), "digit:9");
  // 0 不作为选项直选（选项从 1 开始）
  assert.notEqual(decodeKey("0"), "digit:0");
});

test("decodeKey：空输入 / 未知序列 → null", () => {
  assert.equal(decodeKey(""), null);
  assert.equal(decodeKey(undefined), null);
});

// ── selectMenu：非 TTY 惰性降级 ────────────────────────────────────────────

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

test("selectMenu：非 TTY 直接返回默认值，不写任何 ANSI、不吞 stdin", async () => {
  const stream = fakeStream({ isTTY: false });
  // 故意给一个不支持 setRawMode 的假 input
  const input = { isTTY: false };
  const value = await selectMenu(
    "选一个",
    [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    { def: "b", stream, input }
  );
  assert.equal(value, "b"); // 命中默认值
  assert.equal(stream.output, ""); // 非 TTY 绝不画菜单
});

test("selectMenu：非 TTY 且无默认值时返回第一项", async () => {
  const stream = fakeStream({ isTTY: false });
  const input = { isTTY: false };
  const value = await selectMenu(
    "选一个",
    [
      { value: "x", label: "X" },
      { value: "y", label: "Y" },
    ],
    { stream, input }
  );
  assert.equal(value, "x");
});

test("selectMenu：字符串数组选项也能工作", async () => {
  const stream = fakeStream({ isTTY: false });
  const input = { isTTY: false };
  const value = await selectMenu("选一个", ["one", "two"], { def: "two", stream, input });
  assert.equal(value, "two");
});

// ── textInput：非 TTY 惰性降级 ─────────────────────────────────────────────

test("textInput：非 TTY 返回默认值，不创建 readline、不挂起", async () => {
  const stream = fakeStream({ isTTY: false });
  const input = { isTTY: false };
  const value = await textInput("baseURL", { def: "https://api.example/v1", stream, input });
  assert.equal(value, "https://api.example/v1");
  assert.equal(stream.output, "");
});
