import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLASH_COMMANDS,
  slashCompleter,
  normalizeHistory,
  appendHistory,
} from "../src/repl-support.mjs";

// ---- slashCompleter --------------------------------------------------------

test("slashCompleter: 输入 / 返回全部 slash 命令", () => {
  const [hits, line] = slashCompleter("/");
  assert.equal(line, "/");
  assert.deepEqual(hits, SLASH_COMMANDS.map((c) => c.name));
});

test("slashCompleter: 前缀过滤（/i → /init）", () => {
  const [hits] = slashCompleter("/i");
  assert.deepEqual(hits, ["/init"]);
});

test("slashCompleter: 前缀过滤（/s → /status）", () => {
  const [hits] = slashCompleter("/s");
  assert.deepEqual(hits, ["/status"]);
});

test("slashCompleter: 非 slash 输入不补全", () => {
  const [hits, line] = slashCompleter("hello");
  assert.deepEqual(hits, []);
  assert.equal(line, "hello");
});

test("slashCompleter: 命令后有空格则停止补全（进入参数区）", () => {
  const [hits] = slashCompleter("/plan 给项目");
  assert.deepEqual(hits, []);
});

test("slashCompleter: 无匹配前缀时回退全集，避免吞输入", () => {
  const [hits] = slashCompleter("/zzz");
  assert.deepEqual(hits, SLASH_COMMANDS.map((c) => c.name));
});

// ---- normalizeHistory ------------------------------------------------------

test("normalizeHistory: 去空行、trim、折叠连续重复", () => {
  // 遍历中先跳空行，故第二个 b 与已入列的 b 相邻 → 被折叠。结果 ["a","b"]。
  const out = normalizeHistory(["  ", "a", "a", "b", "", "b"]);
  assert.deepEqual(out, ["a", "b"]);
});

test("normalizeHistory: 非连续重复（中间隔着不同项）保留", () => {
  const out = normalizeHistory(["a", "b", "a"]);
  assert.deepEqual(out, ["a", "b", "a"]);
});

test("normalizeHistory: 多行输入压成单行", () => {
  const out = normalizeHistory(["line1\nline2"]);
  assert.deepEqual(out, ["line1 line2"]);
});

test("normalizeHistory: 截断到 limit，保留最新（末尾）", () => {
  const out = normalizeHistory(["1", "2", "3", "4"], { limit: 2 });
  assert.deepEqual(out, ["3", "4"]);
});

test("normalizeHistory: 非数组输入返回空", () => {
  assert.deepEqual(normalizeHistory(null), []);
  assert.deepEqual(normalizeHistory(undefined), []);
});

// ---- appendHistory ---------------------------------------------------------

test("appendHistory: 追加新行且不改原数组", () => {
  const orig = ["a"];
  const out = appendHistory(orig, "b");
  assert.deepEqual(out, ["a", "b"]);
  assert.deepEqual(orig, ["a"], "原数组不应被修改");
});

test("appendHistory: 与末尾重复的输入被折叠", () => {
  const out = appendHistory(["a", "b"], "b");
  assert.deepEqual(out, ["a", "b"]);
});

test("SLASH_COMMANDS: 结构完整（每项有 name/desc，name 以 / 开头）", () => {
  assert.ok(SLASH_COMMANDS.length >= 6);
  for (const c of SLASH_COMMANDS) {
    assert.equal(typeof c.name, "string");
    assert.ok(c.name.startsWith("/"), `命令名应以 / 开头：${c.name}`);
    assert.equal(typeof c.desc, "string");
    assert.ok(c.desc.length > 0);
  }
  // /init 与 /plan 必须存在（本次补齐的承诺命令）。
  const names = SLASH_COMMANDS.map((c) => c.name);
  assert.ok(names.includes("/init"));
  assert.ok(names.includes("/plan"));
});
