// 服务商预设表测试。
//
// PROVIDER_PRESETS 是 setup ③"选一家就好"体验的数据来源，纯静态、天然离线。
// 验证：结构完整性、每个联网预设都带出 baseURL+model、custom 逃生口存在且为空、
// findProviderPreset 按 id 命中与兜底。

import { test, before } from "node:test";
import assert from "node:assert/strict";

let core;

before(async () => {
  core = await import("../src/index.mjs");
});

test("PROVIDER_PRESETS 是非空数组且被冻结", () => {
  const { PROVIDER_PRESETS } = core;
  assert.ok(Array.isArray(PROVIDER_PRESETS), "应为数组");
  assert.ok(PROVIDER_PRESETS.length >= 5, "至少应内置 5 家常见服务商 + custom");
  assert.ok(Object.isFrozen(PROVIDER_PRESETS), "应被冻结，防止运行时篡改");
});

test("每个预设都有 id/label/hint，id 唯一", () => {
  const { PROVIDER_PRESETS } = core;
  const ids = new Set();
  for (const p of PROVIDER_PRESETS) {
    assert.equal(typeof p.id, "string");
    assert.ok(p.id.length > 0, "id 非空");
    assert.equal(typeof p.label, "string");
    assert.ok(p.label.length > 0, "label 非空");
    assert.equal(typeof p.hint, "string");
    assert.ok(!ids.has(p.id), `id 重复：${p.id}`);
    ids.add(p.id);
  }
});

test("DeepSeek 排在第一（用户当前默认）", () => {
  const { PROVIDER_PRESETS } = core;
  assert.equal(PROVIDER_PRESETS[0].id, "deepseek");
  assert.equal(PROVIDER_PRESETS[0].baseURL, "https://api.deepseek.com");
  assert.equal(PROVIDER_PRESETS[0].model, "deepseek-chat");
});

test("除 custom 外的预设都带出非空 baseURL 与 model", () => {
  const { PROVIDER_PRESETS } = core;
  for (const p of PROVIDER_PRESETS) {
    if (p.id === "custom") continue;
    assert.ok(p.baseURL && p.baseURL.length > 0, `${p.id} 应有 baseURL`);
    assert.ok(p.model && p.model.length > 0, `${p.id} 应有默认模型名`);
    assert.match(p.baseURL, /^https?:\/\//, `${p.id} 的 baseURL 应是合法 URL`);
  }
});

test("custom 逃生口存在，且 baseURL/model 为空（表示手填）", () => {
  const { PROVIDER_PRESETS } = core;
  const custom = PROVIDER_PRESETS.find((p) => p.id === "custom");
  assert.ok(custom, "必须有 custom 逃生口");
  assert.equal(custom.baseURL, "");
  assert.equal(custom.model, "");
});

test("findProviderPreset 按 id 命中，未知 id 返回 undefined", () => {
  const { findProviderPreset } = core;
  assert.equal(findProviderPreset("deepseek").label, "DeepSeek");
  assert.equal(findProviderPreset("kimi").model, "moonshot-v1-8k");
  assert.equal(findProviderPreset("不存在的家"), undefined);
});
