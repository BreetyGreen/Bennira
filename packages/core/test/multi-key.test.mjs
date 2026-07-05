// 多 key 与内置模型目录测试
// -----------------------------------------------------------------------------
// 覆盖本轮新增能力：
//   1. 内置模型目录 builtinModels / 合并 mergeModelLists（策略一 + 策略二叠加）
//   2. 多 key 数据层：addModelKey / listModelKeys / useModelKey / removeModelKey
//   3. 旧单 key 结构向后兼容（{model:{apiKey}} 自动升级为一把「默认」key）
//   4. maskKey 脱敏、saveModelApiKey 覆盖当前激活不堆积
//
// 全程假 key，不发网络请求。用 BENNIRA_HOME 隔离全局层，scope:"project" 配 projectRoot。

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
const PROJ = { scope: "project" };

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

// ---- 内置模型目录 + 合并 -----------------------------------------------------

test("builtinModels 返回预设内置目录，custom 为空", () => {
  const dsk = core.builtinModels("deepseek");
  assert.ok(dsk.includes("deepseek-chat"));
  assert.ok(dsk.length >= 2);
  assert.deepEqual(core.builtinModels("custom"), []);
  assert.deepEqual(core.builtinModels("不存在"), []);
});

test("builtinModels 返回副本，改动不污染预设", () => {
  const a = core.builtinModels("openai");
  a.push("我乱加的");
  const b = core.builtinModels("openai");
  assert.ok(!b.includes("我乱加的"));
});

test("mergeModelLists 内置在前、实时补后、去重且实时部分排序", () => {
  const merged = core.mergeModelLists(
    ["gpt-4o-mini", "gpt-4o"],
    ["gpt-4o", "zzz-new", "aaa-new"]
  );
  // 内置原序在前
  assert.equal(merged[0], "gpt-4o-mini");
  assert.equal(merged[1], "gpt-4o");
  // 实时新增去重（gpt-4o 不重复）并按字母序
  assert.deepEqual(merged.slice(2), ["aaa-new", "zzz-new"]);
});

test("mergeModelLists 任一为空都能退化", () => {
  assert.deepEqual(core.mergeModelLists(["a", "b"], []), ["a", "b"]);
  assert.deepEqual(core.mergeModelLists([], ["b", "a"]), ["a", "b"]);
  assert.deepEqual(core.mergeModelLists(null, null), []);
});

// ---- maskKey 脱敏 ------------------------------------------------------------

test("maskKey 只留头尾，短串也不整串外泄", () => {
  assert.equal(core.maskKey("sk-abcdefghij"), "sk-a…ghij");
  assert.equal(core.maskKey("short"), "sh***");
  assert.equal(core.maskKey(""), "");
});

// ---- 向后兼容：旧单 key 结构 -------------------------------------------------

test("旧 {model:{apiKey}} 结构自动升级为一把「默认」key", () => {
  core.writeSecrets(projectRoot, { model: { apiKey: "sk-oldstyle-123456" } });
  const cred = core.resolveModelCredentials(projectRoot);
  assert.equal(cred.apiKey, "sk-oldstyle-123456");
  assert.equal(cred.source, "file-project");
  assert.equal(cred.keyId, "default");

  const { keys, activeKeyId } = core.listModelKeys(projectRoot, PROJ);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, "default");
  assert.equal(activeKeyId, "default");
  assert.equal(keys[0].masked, core.maskKey("sk-oldstyle-123456"));
});

// ---- 多 key CRUD -------------------------------------------------------------

test("addModelKey 新增即激活，带 provider/label", () => {
  const r1 = core.addModelKey(projectRoot, { apiKey: "sk-a-1111", label: "个人号", provider: "deepseek" }, PROJ);
  const r2 = core.addModelKey(projectRoot, { apiKey: "sk-b-2222", label: "工作号", provider: "openai" }, PROJ);
  assert.notEqual(r1.id, r2.id);

  const { keys, activeKeyId } = core.listModelKeys(projectRoot, PROJ);
  assert.equal(keys.length, 2);
  assert.equal(activeKeyId, r2.id); // 最后加的被激活
  const k2 = keys.find((k) => k.id === r2.id);
  assert.equal(k2.provider, "openai");
  assert.equal(k2.label, "工作号");
  assert.equal(k2.active, true);
  // 列表脱敏，绝不含明文
  assert.ok(!JSON.stringify(keys).includes("sk-a-1111"));
});

test("resolveModelCredentials 跟随激活 key", () => {
  const r1 = core.addModelKey(projectRoot, { apiKey: "sk-a-1111", label: "A" }, PROJ);
  core.addModelKey(projectRoot, { apiKey: "sk-b-2222", label: "B" }, PROJ);
  // 当前激活是 B
  assert.equal(core.resolveModelCredentials(projectRoot).apiKey, "sk-b-2222");
  // 切回 A
  core.useModelKey(projectRoot, r1.id, PROJ);
  const cred = core.resolveModelCredentials(projectRoot);
  assert.equal(cred.apiKey, "sk-a-1111");
  assert.equal(cred.keyId, r1.id);
  assert.equal(cred.label, "A");
});

test("useModelKey 切换不存在的 id 抛错", () => {
  core.addModelKey(projectRoot, { apiKey: "sk-a-1111" }, PROJ);
  assert.throws(() => core.useModelKey(projectRoot, "不存在", PROJ), /未找到 key/);
});

test("removeModelKey 删激活项时自动改激活第一把", () => {
  const r1 = core.addModelKey(projectRoot, { apiKey: "sk-a-1111", label: "A" }, PROJ);
  const r2 = core.addModelKey(projectRoot, { apiKey: "sk-b-2222", label: "B" }, PROJ);
  // 激活是 r2，删掉它
  const res = core.removeModelKey(projectRoot, r2.id, PROJ);
  assert.equal(res.activeKeyId, r1.id); // 自动落到剩下的第一把
  const { keys } = core.listModelKeys(projectRoot, PROJ);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, r1.id);
});

test("removeModelKey 删最后一把后激活为空", () => {
  const r1 = core.addModelKey(projectRoot, { apiKey: "sk-a-1111" }, PROJ);
  const res = core.removeModelKey(projectRoot, r1.id, PROJ);
  assert.equal(res.activeKeyId, null);
  assert.equal(core.hasModelCredentials(projectRoot), false);
});

test("removeModelKey 删不存在的 id 抛错", () => {
  assert.throws(() => core.removeModelKey(projectRoot, "无", PROJ), /未找到 key/);
});

// ---- saveModelApiKey 覆盖不堆积 + 环境变量优先 --------------------------------

test("saveModelApiKey 覆盖当前激活 key，不堆积重复", () => {
  core.saveModelApiKey(projectRoot, "sk-first-1111", PROJ);
  core.saveModelApiKey(projectRoot, "sk-second-2222", PROJ);
  const { keys } = core.listModelKeys(projectRoot, PROJ);
  assert.equal(keys.length, 1); // 覆盖而非新增
  assert.equal(core.resolveModelCredentials(projectRoot).apiKey, "sk-second-2222");
});

test("环境变量仍压过多 key 文件", () => {
  core.addModelKey(projectRoot, { apiKey: "sk-file-1111" }, PROJ);
  process.env.BENNIRA_API_KEY = "sk-env-9999";
  const cred = core.resolveModelCredentials(projectRoot);
  assert.equal(cred.apiKey, "sk-env-9999");
  assert.equal(cred.source, "env");
});
