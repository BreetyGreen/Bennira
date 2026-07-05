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

// 选中态高亮契约：明暗无关，不依赖背景探测 --------------------------------------
// 菜单选中项必须带「品牌色背景块」，未选中项用终端默认前景（无色码）。
// 这样即便 OSC 11 探测失败、盘子选错深浅，菜单也永远可读。

test("selected：启用色时铺品牌背景块 + 白字（明暗无关高亮）", () => {
  const t = core.createTheme({}, { enabled: true });
  const out = t.selected("project");
  assert.ok(out.includes("48;2;"), "应含背景色码 [48;2（品牌紫背景块）");
  assert.ok(out.includes("255;255;255"), "应含白色前景 [38;2;255;255;255");
  assert.ok(out.includes("project"));
});

test("selected：深色盘与浅色盘都带背景块（不因盘子切换而消失）", () => {
  const dark = core.createTheme({ theme: { active: "thief" } }, { enabled: true });
  const light = core.createTheme(
    { theme: { active: "thief", appearance: "light" } },
    { enabled: true }
  );
  assert.ok(dark.selected("x").includes("48;2;"), "深色盘选中项应有背景块");
  assert.ok(light.selected("x").includes("48;2;"), "浅色盘选中项应有背景块");
});

test("selected：降级（enabled=false）用 ▶ 标记选中，纯文本也可辨", () => {
  const t = core.createTheme({}, { enabled: false });
  const out = t.selected("project");
  assert.equal(out.includes(ESC), false, "纯文本不应含 ANSI");
  assert.ok(out.includes("▶"), "应用 ▶ 标记选中项");
  assert.ok(out.includes("project"));
});
