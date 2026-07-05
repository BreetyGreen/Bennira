// 主题系统测试 —— 纯逻辑，天然离线、无需 key。
// 覆盖：降级（enabled=false / NO_COLOR / 非 TTY → 无 ANSI）、职业主题解析、
//       token 覆盖、CJK 显示宽度与对齐、未知主题回退默认。

import { test, before } from "node:test";
import assert from "node:assert/strict";

let core;
before(async () => {
  core = await import("../src/index.mjs");
});

const ESC = "\u001b"; // ANSI 转义前缀，用于断言"有没有上色"

test("enabled=false 时所有染色函数返回纯文本（无 ANSI）", () => {
  const t = core.createTheme({}, { enabled: false });
  const out = t.title("标题") + t.accent("cmd") + t.muted("dim");
  assert.equal(out.includes(ESC), false); // 完全无转义序列
  assert.ok(out.includes("标题"));
  assert.ok(out.includes("cmd"));
});

test("NO_COLOR 环境变量强制降级", () => {
  const t = core.createTheme({}, { env: { NO_COLOR: "1" }, stream: { isTTY: true } });
  assert.equal(t.enabled, false);
  assert.equal(t.value("x").includes(ESC), false);
});

test("非 TTY（管道 / 重定向）自动降级", () => {
  const t = core.createTheme({}, { env: {}, stream: { isTTY: false } });
  assert.equal(t.enabled, false);
});

test("FORCE_COLOR 时启用上色，输出含 ANSI", () => {
  const t = core.createTheme({}, { env: { FORCE_COLOR: "1" }, stream: { isTTY: false } });
  assert.equal(t.enabled, true);
  assert.ok(t.brand("x").includes(ESC));
});

test("默认主题是盗贼（thief），标志色为缇利翁皇家紫", () => {
  const spec = core.resolveThemeSpec({});
  assert.equal(spec.id, "thief");
  assert.equal(spec.job, "盗贼");
  assert.equal(spec.colors.brand.toLowerCase(), "#9450c9");
});

test("切换到剑士（warrior）主题", () => {
  const spec = core.resolveThemeSpec({ theme: { active: "warrior" } });
  assert.equal(spec.id, "warrior");
  assert.equal(spec.job, "剑士");
});

test("token 覆盖生效（overrides 覆盖预设色）", () => {
  const spec = core.resolveThemeSpec({
    theme: { active: "thief", overrides: { accent: "#ff00ff" } },
  });
  assert.equal(spec.colors.accent.toLowerCase(), "#ff00ff");
  // 未覆盖的 token 仍是预设值
  assert.equal(spec.colors.brand.toLowerCase(), "#9450c9");
});

test("未知主题 id 回退到默认盗贼", () => {
  const spec = core.resolveThemeSpec({ theme: { active: "no-such-job" } });
  assert.equal(spec.id, "thief");
});

test("displayWidth：CJK 计 2 列，ASCII 计 1 列", () => {
  assert.equal(core.displayWidth("abc"), 3);
  assert.equal(core.displayWidth("盗贼"), 4);
  assert.equal(core.displayWidth("a盗b"), 4);
});

test("padDisplay：按显示宽度补齐（CJK 感知）", () => {
  // "盗贼"宽 4，补到 6 应加 2 个空格
  assert.equal(core.padDisplay("盗贼", 6), "盗贼  ");
  // 已超宽则原样返回
  assert.equal(core.padDisplay("盗贼贼", 4), "盗贼贼");
});

test("listThemes 至少含全部职业预设，且标出 active", () => {
  const list = core.listThemes({ theme: { active: "hunter" } });
  const presets = list.filter((i) => i.kind === "preset");
  assert.ok(presets.length >= 8); // 八方旅人八职业
  const active = list.find((i) => i.active);
  assert.equal(active.id, "hunter");
});
