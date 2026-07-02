// 凭证优先级测试 —— 证明 resolveModelCredentials 的解析顺序：
//   环境变量 BENNIRA_API_KEY / OPENAI_API_KEY → 项目 secrets → 全局 secrets → none
//
// 重要：这里用的都是【假 key 字符串】，只验证"该选哪一个来源"，
// 从不发起任何网络请求、从不校验 key 真伪。因此 CI 无真实 key 也能全绿。

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
  // 还原环境，避免测试间串味
  if (origHome === undefined) delete process.env.BENNIRA_HOME;
  else process.env.BENNIRA_HOME = origHome;
  if (origBennira === undefined) delete process.env.BENNIRA_API_KEY;
  else process.env.BENNIRA_API_KEY = origBennira;
  if (origOpenai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = origOpenai;
});

test("无任何来源时 source=none、apiKey 为空", () => {
  const { apiKey, source } = core.resolveModelCredentials(projectRoot);
  assert.equal(apiKey, "");
  assert.equal(source, "none");
  assert.equal(core.hasModelCredentials(projectRoot), false);
});

test("环境变量 BENNIRA_API_KEY 优先级最高", () => {
  process.env.BENNIRA_API_KEY = "sk-env-fake";
  core.saveModelApiKey(projectRoot, "sk-project-fake", { scope: "project" });
  const { apiKey, source } = core.resolveModelCredentials(projectRoot);
  assert.equal(apiKey, "sk-env-fake"); // env 压过文件
  assert.equal(source, "env");
});

test("OPENAI_API_KEY 也被识别为 env 来源", () => {
  process.env.OPENAI_API_KEY = "sk-openai-fake";
  const { apiKey, source } = core.resolveModelCredentials(projectRoot);
  assert.equal(apiKey, "sk-openai-fake");
  assert.equal(source, "env");
});

test("无 env 时，项目 secrets 优先于全局 secrets", () => {
  core.saveModelApiKey(tmpHome, "sk-global-fake", { scope: "global" });
  core.saveModelApiKey(projectRoot, "sk-project-fake", { scope: "project" });
  const { apiKey, source } = core.resolveModelCredentials(projectRoot);
  assert.equal(apiKey, "sk-project-fake");
  assert.equal(source, "file-project");
});

test("只有全局 secrets 时，回退到 file-global", () => {
  core.saveModelApiKey(tmpHome, "sk-global-fake", { scope: "global" });
  const { apiKey, source } = core.resolveModelCredentials(projectRoot);
  assert.equal(apiKey, "sk-global-fake");
  assert.equal(source, "file-global");
});

test("saveModelApiKey 只写 secrets，不碰 config", () => {
  const path = core.saveModelApiKey(projectRoot, "sk-fake", { scope: "project" });
  assert.match(path, /secrets\.json$/);
  const raw = core.readRawConfig(projectRoot);
  assert.equal(raw.model?.apiKey, undefined); // config 里没有 key
  const secrets = core.readSecrets(projectRoot);
  assert.equal(secrets.model.apiKey, "sk-fake");
});
