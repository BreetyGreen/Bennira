// plan 解析 + 模型就绪 / 权限门测试。
//
// parsePlanResponse 是纯字符串解析，天然离线。
// modelReadiness / createProvider 只做"配置与权限判断"，
// 用假 key 验证：network=deny 时抛 NetworkDeniedError（不发请求）、
// 缺配置时抛 ModelConfigError。全程零网络、零真实 key。

import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let core;
let tmpHome;
let projectRoot;
const origHome = process.env.BENNIRA_HOME;
const origBennira = process.env.BENNIRA_API_KEY;
const origOpenai = process.env.OPENAI_API_KEY;

before(async () => {
  core = await import("../src/index.mjs");
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "bennira-home-"));
  projectRoot = mkdtempSync(join(tmpdir(), "bennira-proj-"));
  process.env.BENNIRA_HOME = tmpHome;
  delete process.env.BENNIRA_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.BENNIRA_HOME;
  else process.env.BENNIRA_HOME = origHome;
  if (origBennira === undefined) delete process.env.BENNIRA_API_KEY;
  else process.env.BENNIRA_API_KEY = origBennira;
  if (origOpenai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = origOpenai;
});

// --- parsePlanResponse ------------------------------------------------------

test("解析标准 JSON 计划", () => {
  const raw = JSON.stringify({
    summary: "推进小偷 Alpha",
    nextSteps: ["整理需求", "刷新 handoff"],
    notes: "注意边界",
  });
  const parsed = core.parsePlanResponse(raw);
  assert.equal(parsed.summary, "推进小偷 Alpha");
  assert.deepEqual(parsed.nextSteps, ["整理需求", "刷新 handoff"]);
  assert.equal(parsed.notes, "注意边界");
});

test("解析被 ```json 代码块包裹的计划", () => {
  const raw = "```json\n" + JSON.stringify({ summary: "s", nextSteps: ["a"] }) + "\n```";
  const parsed = core.parsePlanResponse(raw);
  assert.equal(parsed.summary, "s");
  assert.deepEqual(parsed.nextSteps, ["a"]);
});

test("nextSteps 中的非字符串被过滤", () => {
  const raw = JSON.stringify({ summary: "s", nextSteps: ["ok", 123, "", "good"] });
  const parsed = core.parsePlanResponse(raw);
  assert.deepEqual(parsed.nextSteps, ["ok", "good"]);
});

test("非 JSON 文本走兜底解析（首行作 summary）", () => {
  const parsed = core.parsePlanResponse("第一行概括\n第二步\n第三步");
  assert.equal(parsed.summary, "第一行概括");
  assert.ok(parsed.nextSteps.includes("第二步"));
  assert.match(parsed.notes, /兜底/);
});

// --- modelReadiness ---------------------------------------------------------

test("默认（network=deny、无配置、无 key）→ 未就绪", () => {
  const cfg = core.readConfig(projectRoot);
  const rd = core.modelReadiness(projectRoot, cfg);
  assert.equal(rd.ready, false);
  assert.equal(rd.networkAllowed, false);
  assert.equal(rd.hasKey, false);
  assert.equal(rd.keySource, "none");
});

test("配齐 baseURL+model+key 且 network=allow → 就绪（用假 key）", () => {
  core.updateModelConfig(projectRoot, { baseURL: "https://x/v1", model: "m" }, { scope: "project" });
  core.updatePermission(projectRoot, "network", "allow", { scope: "project" });
  core.saveModelApiKey(projectRoot, "sk-fake-not-real", { scope: "project" });
  const cfg = core.readConfig(projectRoot);
  const rd = core.modelReadiness(projectRoot, cfg);
  assert.equal(rd.ready, true);
  assert.equal(rd.hasBaseURL, true);
  assert.equal(rd.hasModel, true);
  assert.equal(rd.hasKey, true);
});

// --- createProvider 权限门（关键安全约束）----------------------------------

test("network=deny 时 createProvider 抛 NetworkDeniedError（即便有 key）", () => {
  core.updateModelConfig(projectRoot, { baseURL: "https://x/v1", model: "m" }, { scope: "project" });
  core.saveModelApiKey(projectRoot, "sk-fake", { scope: "project" });
  // 不开 network（默认 deny）
  const cfg = core.readConfig(projectRoot);
  assert.throws(() => core.createProvider(projectRoot, cfg), core.NetworkDeniedError);
});

test("network=allow 但缺 key 时抛 ModelConfigError", () => {
  core.updateModelConfig(projectRoot, { baseURL: "https://x/v1", model: "m" }, { scope: "project" });
  core.updatePermission(projectRoot, "network", "allow", { scope: "project" });
  const cfg = core.readConfig(projectRoot);
  assert.throws(() => core.createProvider(projectRoot, cfg), core.ModelConfigError);
});

test("配齐后 createProvider 返回可用 provider（不发请求，只构建对象）", () => {
  core.updateModelConfig(projectRoot, { baseURL: "https://x/v1", model: "m" }, { scope: "project" });
  core.updatePermission(projectRoot, "network", "allow", { scope: "project" });
  core.saveModelApiKey(projectRoot, "sk-fake", { scope: "project" });
  const cfg = core.readConfig(projectRoot);
  const provider = core.createProvider(projectRoot, cfg);
  assert.equal(typeof provider.generate, "function"); // 有能力，但本测试不调用它
});
