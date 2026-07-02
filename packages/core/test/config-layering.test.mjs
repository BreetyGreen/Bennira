// 配置分层合并测试 —— core 最需要保护的逻辑。
// 覆盖：全局→项目深合并、项目层只存差异、空 baseURL 不反向覆盖全局、
//       默认值兜底、readRawConfig 只读单层、updateModelConfig 拒绝落 apiKey。
//
// 全程离线、不需要任何 API key：通过 BENNIRA_HOME 把"全局根"重定向到临时目录，
// 避免碰真实的 ~/.bennira，并与项目层隔离。

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome; // 充当全局根 ~
let projectRoot; // 充当某个项目根
const origHome = process.env.BENNIRA_HOME;

// 动态 import：必须在设置 BENNIRA_HOME 后再加载模块，
// 但 scope.globalRoot() 每次都读 process.env，所以运行期改也生效。
let core;

before(async () => {
  core = await import("../src/index.mjs");
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "bennira-home-"));
  projectRoot = mkdtempSync(join(tmpdir(), "bennira-proj-"));
  process.env.BENNIRA_HOME = tmpHome;
});

after(() => {
  if (origHome === undefined) delete process.env.BENNIRA_HOME;
  else process.env.BENNIRA_HOME = origHome;
});

function writeConfigLayer(root, obj) {
  const dir = join(root, ".bennira");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(obj, null, 2), "utf8");
}

test("空项目：readConfig 返回默认值兜底", () => {
  const cfg = core.readConfig(projectRoot);
  assert.equal(cfg.language, "zh-CN");
  assert.equal(cfg.permissions.network, "deny"); // 盗贼默认谨慎
  assert.equal(cfg.model.provider, "openai-compatible");
  assert.equal(cfg.theme.active, "thief");
});

test("全局层配置被项目继承", () => {
  writeConfigLayer(tmpHome, {
    model: { baseURL: "https://global.example/v1", model: "global-model" },
  });
  const cfg = core.readConfig(projectRoot);
  assert.equal(cfg.model.baseURL, "https://global.example/v1");
  assert.equal(cfg.model.model, "global-model");
});

test("项目层覆盖全局层，且只覆盖显式出现的键", () => {
  writeConfigLayer(tmpHome, {
    model: { baseURL: "https://global.example/v1", model: "global-model" },
  });
  writeConfigLayer(projectRoot, {
    model: { model: "project-model" }, // 只改 model，不动 baseURL
  });
  const cfg = core.readConfig(projectRoot);
  assert.equal(cfg.model.model, "project-model"); // 项目层覆盖
  assert.equal(cfg.model.baseURL, "https://global.example/v1"); // baseURL 继承全局
});

test("项目层不出现的键，不会用空值反向覆盖全局（关键防坑）", () => {
  writeConfigLayer(tmpHome, {
    model: { baseURL: "https://global.example/v1", model: "global-model" },
  });
  // 项目层完全不含 model.baseURL —— 不应把全局 baseURL 冲成空。
  writeConfigLayer(projectRoot, { theme: { active: "warrior" } });
  const cfg = core.readConfig(projectRoot);
  assert.equal(cfg.model.baseURL, "https://global.example/v1");
  assert.equal(cfg.theme.active, "warrior");
});

test("readRawConfig 只读单层，不叠加默认值", () => {
  writeConfigLayer(projectRoot, { theme: { active: "hunter" } });
  const raw = core.readRawConfig(projectRoot);
  assert.deepEqual(raw, { theme: { active: "hunter" } });
  assert.equal(raw.language, undefined); // 没有默认值污染
});

test("updateModelConfig 即便误传 apiKey 也不落进 config.json", () => {
  core.updateModelConfig(
    projectRoot,
    { baseURL: "https://x/v1", model: "m", apiKey: "sk-should-not-persist" },
    { scope: "project" }
  );
  const raw = core.readRawConfig(projectRoot);
  assert.equal(raw.model.baseURL, "https://x/v1");
  assert.equal(raw.model.apiKey, undefined); // 防御成功：key 绝不入 config
});

test("updateThemeConfig 写项目层不污染全局层", () => {
  core.updateThemeConfig(projectRoot, { active: "merchant" }, { scope: "project" });
  const projRaw = core.readRawConfig(projectRoot);
  const globalRaw = core.readRawConfig(tmpHome);
  assert.equal(projRaw.theme.active, "merchant");
  assert.deepEqual(globalRaw, {}); // 全局层没被碰
});
