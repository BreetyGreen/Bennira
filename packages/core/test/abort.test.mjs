// 中断语义 + UserAbortError 测试。
//
// 核心：验证"外部 signal 预先 abort → generate/generateStream 立即抛 UserAbortError"，
// 且不发出真实网络请求（signal 已 abort，fetch 会同步拒绝）。全程零网络、假 key。

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

function readyProvider() {
  core.updateModelConfig(projectRoot, { baseURL: "https://x.invalid/v1", model: "m" }, { scope: "project" });
  core.updatePermission(projectRoot, "network", "allow", { scope: "project" });
  core.saveModelApiKey(projectRoot, "sk-fake-not-real", { scope: "project" });
  const cfg = core.readConfig(projectRoot);
  return core.createProvider(projectRoot, cfg);
}

// ---- UserAbortError 结构 ---------------------------------------------------

test("UserAbortError 具备可识别的 code=USER_ABORT", () => {
  const e = new core.UserAbortError();
  assert.equal(e.code, "USER_ABORT");
  assert.equal(e.name, "UserAbortError");
  assert.ok(e instanceof Error);
});

// ---- generate 中断语义 -----------------------------------------------------

test("generate: 传入已 abort 的 signal → 抛 UserAbortError（不发真请求）", async () => {
  const provider = readyProvider();
  const ac = new AbortController();
  ac.abort(); // 预先中断
  await assert.rejects(
    () => provider.generate([{ role: "user", content: "hi" }], { signal: ac.signal }),
    (err) => {
      assert.equal(err.code, "USER_ABORT", `期望 USER_ABORT，实得 ${err.code}: ${err.message}`);
      return true;
    }
  );
});

test("generateStream: 传入已 abort 的 signal → 抛 UserAbortError（不发真请求）", async () => {
  const provider = readyProvider();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => provider.generateStream([{ role: "user", content: "hi" }], () => {}, { signal: ac.signal }),
    (err) => {
      assert.equal(err.code, "USER_ABORT", `期望 USER_ABORT，实得 ${err.code}: ${err.message}`);
      return true;
    }
  );
});

test("generate: 不传 signal 时行为不变（连不上 → ModelRequestError，非 abort）", async () => {
  const provider = readyProvider();
  // baseURL 指向 .invalid 域名，必然连接失败 → 归类为 ModelRequestError（连接失败），
  // 而不是 USER_ABORT。验证"没有外部中断时，错误分类不被污染"。
  await assert.rejects(
    () => provider.generate([{ role: "user", content: "hi" }]),
    (err) => {
      assert.notEqual(err.code, "USER_ABORT", "无外部中断时不应被判为 USER_ABORT");
      return true;
    }
  );
});
