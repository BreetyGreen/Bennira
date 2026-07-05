// setup 体验升级测试 —— 覆盖本轮四项改动的纯逻辑面：
//   D. listModels：GET /v1/models 解析、多形态兼容、失败优雅降级（mock fetch，零真实网络）
//   B. isThemeUnlocked / listThemes.unlocked：一代只开放盗贼，其余锁定
//   C. detectBackground / resolveThemeSpec 浅色盘：白底自动切深字盘，默认仍深色盘
//   C. selectMenu 禁用项：非 TTY 降级仍跳过 disabled、落在可选项上
//
// 全程离线：listModels 用可控的 fake fetch 注入，绝不打真实网络。

import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";

let core;
before(async () => {
  core = await import("../src/index.mjs");
});

// ── 工具：临时替换 global.fetch，测完还原 ──────────────────────────────────
const origFetch = global.fetch;
afterEach(() => {
  global.fetch = origFetch;
});

function mockFetch(handler) {
  global.fetch = async (url, init) => handler(url, init);
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ── D. listModels ──────────────────────────────────────────────────────────

test("listModels：解析 OpenAI 形态 { data:[{id}] }，去重 + 排序", async () => {
  let seenUrl = "";
  let seenAuth = "";
  mockFetch((url, init) => {
    seenUrl = url;
    seenAuth = init.headers.Authorization || "";
    return jsonResponse({
      data: [{ id: "gpt-4o" }, { id: "gpt-3.5" }, { id: "gpt-4o" }],
    });
  });
  const res = await core.listModels("https://api.openai.com/v1", "sk-xyz");
  assert.equal(res.ok, true);
  // 去重（gpt-4o 只剩一个）+ 字母序排序
  assert.deepEqual(res.models, ["gpt-3.5", "gpt-4o"]);
  // 端点拼接正确：/v1 → /v1/models
  assert.equal(seenUrl, "https://api.openai.com/v1/models");
  // key 带进 Authorization（这正是"先填 key 才拉得到"的机制）
  assert.equal(seenAuth, "Bearer sk-xyz");
});

test("listModels：裸域名自动补 /v1/models", async () => {
  let seenUrl = "";
  mockFetch((url) => {
    seenUrl = url;
    return jsonResponse({ data: [{ id: "deepseek-chat" }] });
  });
  await core.listModels("https://api.deepseek.com", "sk-1");
  assert.equal(seenUrl, "https://api.deepseek.com/v1/models");
});

test("listModels：已带 /models 的 baseURL 不重复拼接", async () => {
  let seenUrl = "";
  mockFetch((url) => {
    seenUrl = url;
    return jsonResponse({ data: [{ id: "m" }] });
  });
  await core.listModels("https://x.test/v1/models", "sk-1");
  assert.equal(seenUrl, "https://x.test/v1/models");
});

test("listModels：兼容纯数组与 { models:[...] } 形态", async () => {
  mockFetch(() => jsonResponse(["b-model", "a-model"]));
  const r1 = await core.listModels("https://x.test/v1", "k");
  assert.deepEqual(r1.models, ["a-model", "b-model"]);

  mockFetch(() => jsonResponse({ models: ["llama3", "qwen"] }));
  const r2 = await core.listModels("https://x.test/v1", "k");
  assert.deepEqual(r2.models, ["llama3", "qwen"]);
});

test("listModels：缺 baseURL → ok:false，不发请求", async () => {
  let called = false;
  mockFetch(() => {
    called = true;
    return jsonResponse({ data: [] });
  });
  const res = await core.listModels("", "sk-x");
  assert.equal(res.ok, false);
  assert.equal(called, false);
  assert.match(res.error, /baseURL/);
});

test("listModels：401（无 key/无权限）→ ok:false 且带 status，优雅降级", async () => {
  mockFetch(() => jsonResponse({ error: "unauthorized" }, { ok: false, status: 401 }));
  const res = await core.listModels("https://api.openai.com/v1", "");
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.models.length, 0);
});

test("listModels：网络异常（fetch 抛错）→ ok:false，不崩溃", async () => {
  mockFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  const res = await core.listModels("https://x.invalid/v1", "k");
  assert.equal(res.ok, false);
  assert.match(res.error, /无法连接|ECONNREFUSED/);
});

test("listModels：服务返回空列表 → ok:false（触发上层手填降级）", async () => {
  mockFetch(() => jsonResponse({ data: [] }));
  const res = await core.listModels("https://x.test/v1", "k");
  assert.equal(res.ok, false);
  assert.match(res.error, /未返回任何模型/);
});

test("listModels：Ollama 免 key 也能拉（不带 Authorization 头）", async () => {
  let hasAuth = true;
  mockFetch((url, init) => {
    hasAuth = "Authorization" in (init.headers || {});
    return jsonResponse({ data: [{ id: "llama3" }] });
  });
  const res = await core.listModels("http://localhost:11434/v1", "");
  assert.equal(res.ok, true);
  assert.equal(hasAuth, false); // 无 key 时不加 Authorization 头
});

// ── B. 职业锁定 ──────────────────────────────────────────────────────────

test("isThemeUnlocked：一代仅盗贼开放，其余职业锁定", () => {
  assert.equal(core.isThemeUnlocked("thief"), true);
  assert.equal(core.isThemeUnlocked("warrior"), false);
  assert.equal(core.isThemeUnlocked("scholar"), false);
  assert.equal(core.isThemeUnlocked("cleric"), false);
});

test("isThemeUnlocked：非预设（自定义/未知 id）一律视为开放，不拦", () => {
  assert.equal(core.isThemeUnlocked("my-custom"), true);
  assert.equal(core.isThemeUnlocked("no-such"), true);
});

test("listThemes：每个预设都带 unlocked，且只有 thief=true", () => {
  const list = core.listThemes({});
  const presets = list.filter((i) => i.kind === "preset");
  const unlocked = presets.filter((i) => i.unlocked);
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].id, "thief");
});

// ── C. 背景探测 + 浅色盘 ──────────────────────────────────────────────────

test("detectBackground：COLORFGBG 末位判明暗，探测不到→unknown", () => {
  assert.equal(core.detectBackground({ COLORFGBG: "0;15" }), "light"); // 黑字白底
  assert.equal(core.detectBackground({ COLORFGBG: "15;0" }), "dark"); // 白字黑底
  assert.equal(core.detectBackground({ COLORFGBG: "15;7" }), "light"); // 浅灰底
  assert.equal(core.detectBackground({ COLORFGBG: "7;8" }), "dark"); // 8=深
  assert.equal(core.detectBackground({}), "unknown"); // 没设 → 未知
});

test("resolveThemeSpec：默认（无 options）恒走深色盘，brand 不变", () => {
  const spec = core.resolveThemeSpec({});
  assert.equal(spec.appearance, "dark");
  assert.equal(spec.colors.brand.toLowerCase(), "#9450c9");
  // 深色盘的 value 是近白
  assert.equal(spec.colors.value.toLowerCase(), "#e6e1f0");
});

test("resolveThemeSpec：background=light 切浅色盘（value 变深，白底可见）", () => {
  const spec = core.resolveThemeSpec({}, { background: "light" });
  assert.equal(spec.appearance, "light");
  // 浅色盘 value 是近黑
  assert.equal(spec.colors.value.toLowerCase(), "#241c33");
  // brand 也压深了（但仍是缇利翁皇家紫系）
  assert.notEqual(spec.colors.brand.toLowerCase(), "#9450c9");
});

test("resolveThemeSpec：config.theme.appearance=light 也能触发浅色盘", () => {
  const spec = core.resolveThemeSpec({ theme: { appearance: "light" } });
  assert.equal(spec.appearance, "light");
  assert.equal(spec.colors.value.toLowerCase(), "#241c33");
});

test("createTheme：COLORFGBG 白底 + 启用色 → 自动用浅色盘", () => {
  const t = core.createTheme(
    {},
    { enabled: true, env: { COLORFGBG: "0;15" } }
  );
  assert.equal(t.appearance, "light");
  assert.equal(t.colors.value.toLowerCase(), "#241c33");
});

test("createTheme：探测不到背景 → 深色盘（与旧版一致，不破坏现有行为）", () => {
  const t = core.createTheme({}, { enabled: true, env: {} });
  assert.equal(t.appearance, "dark");
  assert.equal(t.colors.value.toLowerCase(), "#e6e1f0");
});

// ── C. selectMenu 禁用项跳过（非 TTY 降级路径可测）────────────────────────

function fakeStream({ isTTY = false } = {}) {
  const chunks = [];
  return { isTTY, write: (s) => (chunks.push(s), true), get output() { return chunks.join(""); } };
}

test("selectMenu：非 TTY 时默认值指向禁用项 → 落到第一个可选项", async () => {
  const stream = fakeStream({ isTTY: false });
  const input = { isTTY: false };
  const value = await core.selectMenu(
    "选一个",
    [
      { value: "locked", label: "锁定", disabled: true },
      { value: "ok", label: "可选" },
    ],
    { def: "locked", stream, input }
  );
  // def 指向禁用项，应跳过它落到第一个可选项 "ok"
  assert.equal(value, "ok");
  assert.equal(stream.output, ""); // 非 TTY 不画菜单
});
