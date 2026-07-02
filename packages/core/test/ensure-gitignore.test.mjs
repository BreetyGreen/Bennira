import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureSecretsIgnored, isSecretsIgnored } from "../src/secrets.mjs";

function tmpProject() {
  return mkdtempSync(join(tmpdir(), "bennira-gitignore-"));
}

test("全新项目（无 .gitignore）：自动创建并写入保护", () => {
  const root = tmpProject();
  try {
    assert.equal(isSecretsIgnored(root), false, "初始应未受保护");
    const { changed, path } = ensureSecretsIgnored(root);
    assert.equal(changed, true, "应报告发生了写入");
    const content = readFileSync(path, "utf8");
    assert.match(content, /\.bennira\/secrets\.json/, "应包含 secrets.json 排除行");
    assert.equal(isSecretsIgnored(root), true, "写入后应受保护");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("已有 .gitignore 但未排除：追加而非覆盖，保留原内容", () => {
  const root = tmpProject();
  try {
    const gi = join(root, ".gitignore");
    writeFileSync(gi, "node_modules/\n*.log\n", "utf8");
    const { changed } = ensureSecretsIgnored(root);
    assert.equal(changed, true);
    const content = readFileSync(gi, "utf8");
    assert.match(content, /node_modules\//, "原有规则必须保留");
    assert.match(content, /\*\.log/, "原有规则必须保留");
    assert.match(content, /\.bennira\/secrets\.json/, "新规则已追加");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("已排除：幂等，changed=false 且不重复写", () => {
  const root = tmpProject();
  try {
    const gi = join(root, ".gitignore");
    writeFileSync(gi, "node_modules/\n.bennira/secrets.json\n", "utf8");
    const before = readFileSync(gi, "utf8");
    const { changed } = ensureSecretsIgnored(root);
    assert.equal(changed, false, "已排除应报告未改动");
    const after = readFileSync(gi, "utf8");
    assert.equal(after, before, "内容应完全不变（幂等）");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("连续调用两次：第二次一定幂等（不重复追加）", () => {
  const root = tmpProject();
  try {
    ensureSecretsIgnored(root);
    const first = readFileSync(join(root, ".gitignore"), "utf8");
    const { changed } = ensureSecretsIgnored(root);
    const second = readFileSync(join(root, ".gitignore"), "utf8");
    assert.equal(changed, false);
    assert.equal(first, second, "重复调用不应改变文件");
    const matches = second.match(/\.bennira\/secrets\.json/g) || [];
    assert.equal(matches.length, 1, "排除行只应出现一次");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
