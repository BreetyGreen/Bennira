// 终端背景明暗探测测试 —— 覆盖 OSC 11 应答解析 + queryTerminalBackground 边界 +
// updateThemeConfig 的 appearance 手动锁定。全程离线，用假 TTY / 假 stdin 注入。
//
// 背景：COLORFGBG 只有少数终端设，macOS Terminal.app 不设，导致旧的 detectBackground
// 永远 unknown、浅色适配从不触发。OSC 11 主动查询终端背景色是更可靠的补充。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let core;
before(async () => {
  core = await import("../src/index.mjs");
});

// ── parseOsc11Response：纯解析，判明暗 ─────────────────────────────────────

test("parseOsc11Response：16-bit 白底 → light", () => {
  // rgb:ffff/ffff/ffff = 纯白背景
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:ffff/ffff/ffff\u0007"), "light");
});

test("parseOsc11Response：16-bit 黑底 → dark", () => {
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:0000/0000/0000\u0007"), "dark");
});

test("parseOsc11Response：8-bit 位宽也能解析（rgb:ff/ff/ff）", () => {
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:ff/ff/ff\u001b\\"), "light");
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:00/00/00\u001b\\"), "dark");
});

test("parseOsc11Response：深灰底（亮度<128）判 dark", () => {
  // rgb:2020/2020/2020 ≈ 32/255，明显偏暗
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:2020/2020/2020\u0007"), "dark");
});

test("parseOsc11Response：浅灰底（亮度≥128）判 light", () => {
  // rgb:d0d0/d0d0/d0d0 ≈ 208/255，明显偏亮
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:d0d0/d0d0/d0d0\u0007"), "light");
});

test("parseOsc11Response：亮度按 sRGB 加权（绿色权重最高）", () => {
  // 纯绿 rgb:0000/ffff/0000：0.587*255≈150 ≥128 → light
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:0000/ffff/0000\u0007"), "light");
  // 纯蓝 rgb:0000/0000/ffff：0.114*255≈29 <128 → dark
  assert.equal(core.parseOsc11Response("\u001b]11;rgb:0000/0000/ffff\u0007"), "dark");
});

test("parseOsc11Response：无 rgb 片段 / 非字符串 → unknown", () => {
  assert.equal(core.parseOsc11Response("garbage"), "unknown");
  assert.equal(core.parseOsc11Response(""), "unknown");
  assert.equal(core.parseOsc11Response(null), "unknown");
  assert.equal(core.parseOsc11Response(undefined), "unknown");
});

// ── queryTerminalBackground：假 TTY 注入应答 ───────────────────────────────

// 造一个可控的假 stdin：EventEmitter + isTTY + setRawMode 桩 + resume/pause。
function fakeStdin() {
  const s = new EventEmitter();
  s.isTTY = true;
  s.isRaw = false;
  s.setRawMode = (v) => {
    s.isRaw = v;
    return s;
  };
  s.resume = () => s;
  s.pause = () => s;
  return s;
}

function fakeStdout() {
  const writes = [];
  return {
    isTTY: true,
    write: (chunk) => {
      writes.push(chunk);
      return true;
    },
    _writes: writes,
  };
}

test("queryTerminalBackground：非 TTY → 直接 unknown（不阻塞、不进 raw mode）", async () => {
  const input = fakeStdin();
  input.isTTY = false;
  const output = fakeStdout();
  const bg = await core.queryTerminalBackground({ input, output, timeoutMs: 50 });
  assert.equal(bg, "unknown");
  assert.equal(input.isRaw, false); // 从未进 raw mode
});

test("queryTerminalBackground：output 非 TTY → unknown", async () => {
  const input = fakeStdin();
  const output = fakeStdout();
  output.isTTY = false;
  const bg = await core.queryTerminalBackground({ input, output, timeoutMs: 50 });
  assert.equal(bg, "unknown");
});

test("queryTerminalBackground：发出 OSC 11 查询序列", async () => {
  const input = fakeStdin();
  const output = fakeStdout();
  const p = core.queryTerminalBackground({ input, output, timeoutMs: 50 });
  // 立即回一个白底应答
  input.emit("data", Buffer.from("\u001b]11;rgb:ffff/ffff/ffff\u0007", "latin1"));
  const bg = await p;
  assert.equal(bg, "light");
  // 确认真的写出了 OSC 11 查询串
  assert.ok(output._writes.some((w) => String(w).includes("]11;?")));
});

test("queryTerminalBackground：收到黑底应答 → dark，并恢复 raw mode", async () => {
  const input = fakeStdin();
  const output = fakeStdout();
  const p = core.queryTerminalBackground({ input, output, timeoutMs: 50 });
  input.emit("data", Buffer.from("\u001b]11;rgb:0000/0000/0000\u001b\\", "latin1"));
  const bg = await p;
  assert.equal(bg, "dark");
  assert.equal(input.isRaw, false); // 结束后恢复
  assert.equal(input.listenerCount("data"), 0); // 监听已移除
});

test("queryTerminalBackground：超时无应答 → unknown（不挂起）", async () => {
  const input = fakeStdin();
  const output = fakeStdout();
  const bg = await core.queryTerminalBackground({ input, output, timeoutMs: 30 });
  assert.equal(bg, "unknown");
  assert.equal(input.isRaw, false); // 超时也恢复
});

// ── updateThemeConfig：appearance 手动锁定 ─────────────────────────────────

test("updateThemeConfig：appearance=light 写入 config.theme.appearance", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "bennira-appear-"));
  try {
    core.updateThemeConfig(dir, { appearance: "light" }, { scope: "project" });
    const cfg = core.readConfig(dir);
    assert.equal(cfg.theme.appearance, "light");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateThemeConfig：appearance=auto 删除该键（回到自动探测）", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "bennira-appear-"));
  try {
    core.updateThemeConfig(dir, { appearance: "dark" }, { scope: "project" });
    assert.equal(core.readConfig(dir).theme.appearance, "dark");
    core.updateThemeConfig(dir, { appearance: "auto" }, { scope: "project" });
    // auto 后该键应被删除，readConfig 合并默认后不含手动锁定
    const raw = core.readConfig(dir);
    assert.equal(raw.theme.appearance, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveThemeSpec：config.theme.appearance 优先于 options.background（手动锁定最强）", () => {
  // 探测说 dark，但用户手动锁 light → 照切浅色盘
  const spec = core.resolveThemeSpec(
    { theme: { appearance: "light" } },
    { background: "dark" }
  );
  assert.equal(spec.appearance, "light");
  assert.equal(spec.colors.value.toLowerCase(), "#241c33"); // 深字盘
});
