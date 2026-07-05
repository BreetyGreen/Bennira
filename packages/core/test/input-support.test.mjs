import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAtMentions,
  atTokenAtEnd,
  atFileCompleter,
  initialInputState,
  feedInputLine,
} from "../src/input-support.mjs";

// ---- extractAtMentions -----------------------------------------------------

test("extractAtMentions: 行首 @path 命中", () => {
  assert.deepEqual(extractAtMentions("@src/index.mjs"), ["src/index.mjs"]);
});

test("extractAtMentions: 空白后 @path 命中，普通词不误判", () => {
  assert.deepEqual(
    extractAtMentions("看下 @a.mjs 和 @b.mjs"),
    ["a.mjs", "b.mjs"],
  );
});

test("extractAtMentions: 邮箱 a@b.com 不被误判为引用", () => {
  assert.deepEqual(extractAtMentions("联系 foo@bar.com 即可"), []);
});

test("extractAtMentions: 词中间的 @（foo@bar）不算引用", () => {
  assert.deepEqual(extractAtMentions("foo@bar"), []);
});

test("extractAtMentions: 引号包裹含空格的路径", () => {
  assert.deepEqual(
    extractAtMentions('打开 @"my dir/a b.txt" 看看'),
    ["my dir/a b.txt"],
  );
});

test("extractAtMentions: 去重且保持出现顺序", () => {
  assert.deepEqual(
    extractAtMentions("@a.mjs 再看 @b.mjs 又是 @a.mjs"),
    ["a.mjs", "b.mjs"],
  );
});

test("extractAtMentions: 清理尾部粘连的标点（中英文），保留扩展名的点", () => {
  assert.deepEqual(extractAtMentions("请看 @src/index.mjs。"), ["src/index.mjs"]);
  assert.deepEqual(extractAtMentions("请看 @src/index.mjs, 谢谢"), ["src/index.mjs"]);
  // 右括号被当作尾部标点剥掉，路径本体保留。
  assert.deepEqual(extractAtMentions("(见 @a/b.js)"), ["a/b.js"]);
});

test("extractAtMentions: 空/非字符串输入返回空数组", () => {
  assert.deepEqual(extractAtMentions(""), []);
  assert.deepEqual(extractAtMentions(null), []);
  assert.deepEqual(extractAtMentions(undefined), []);
});

test("extractAtMentions: 跨行文本也能提取", () => {
  assert.deepEqual(
    extractAtMentions("第一行 @a.mjs\n第二行 @b.mjs"),
    ["a.mjs", "b.mjs"],
  );
});

// ---- atTokenAtEnd ----------------------------------------------------------

test("atTokenAtEnd: 行尾正在敲 @token → active 且给出 prefix", () => {
  const r = atTokenAtEnd("看下 @src/ind");
  assert.equal(r.active, true);
  assert.equal(r.prefix, "src/ind");
});

test("atTokenAtEnd: 光秃秃一个 @ → active，prefix 为空", () => {
  const r = atTokenAtEnd("@");
  assert.equal(r.active, true);
  assert.equal(r.prefix, "");
});

test("atTokenAtEnd: @ 之后出现空白说明引用已敲完 → 不再补全", () => {
  assert.equal(atTokenAtEnd("@a.mjs ").active, false);
});

test("atTokenAtEnd: @ 前非空白（邮箱样式）→ 不激活", () => {
  assert.equal(atTokenAtEnd("foo@bar").active, false);
});

test("atTokenAtEnd: 没有 @ → 不激活", () => {
  const r = atTokenAtEnd("hello world");
  assert.equal(r.active, false);
  assert.equal(r.prefix, "");
});

// ---- atFileCompleter -------------------------------------------------------

test("atFileCompleter: 按 prefix 子串匹配，替换整行 @token", () => {
  const files = ["src/index.mjs", "src/model.mjs", "README.md"];
  const [hits, line] = atFileCompleter("看下 @src", files);
  assert.equal(line, "看下 @src");
  assert.deepEqual(hits, ["看下 @src/index.mjs", "看下 @src/model.mjs"]);
});

test("atFileCompleter: 空 prefix（光秃 @）列出全部候选", () => {
  const files = ["a.mjs", "b.mjs"];
  const [hits] = atFileCompleter("@", files);
  assert.deepEqual(hits, ["@a.mjs", "@b.mjs"]);
});

test("atFileCompleter: 含空格的路径用引号包裹", () => {
  const files = ["my dir/a.txt"];
  const [hits] = atFileCompleter("@my", files);
  assert.deepEqual(hits, ['@"my dir/a.txt"']);
});

test("atFileCompleter: 前缀命中排在子串命中之前", () => {
  const files = ["x/model.mjs", "model.mjs"];
  const [hits] = atFileCompleter("@model", files);
  assert.deepEqual(hits, ["@model.mjs", "@x/model.mjs"]);
});

test("atFileCompleter: 未处于 @token 状态时不补全", () => {
  const [hits, line] = atFileCompleter("hello", ["a.mjs"]);
  assert.deepEqual(hits, []);
  assert.equal(line, "hello");
});

// ---- initialInputState -----------------------------------------------------

test("initialInputState: 初始为 normal 模式、空缓冲", () => {
  const st = initialInputState();
  assert.equal(st.mode, "normal");
  assert.deepEqual(st.buffer, []);
  assert.equal(st.fence, null);
});

// ---- feedInputLine：普通提交 ----------------------------------------------

test("feedInputLine: 普通单行即刻提交", () => {
  const r = feedInputLine(initialInputState(), "hello");
  assert.equal(r.done, true);
  assert.equal(r.value, "hello");
});

test("feedInputLine: state 非法时兜底为初始状态并正常提交", () => {
  const r = feedInputLine(null, "hi");
  assert.equal(r.done, true);
  assert.equal(r.value, "hi");
});

// ---- feedInputLine：反斜杠续行 --------------------------------------------

test("feedInputLine: 行尾单个反斜杠 → 续行，拼成多行", () => {
  let st = initialInputState();
  let r = feedInputLine(st, "line1 \\");
  assert.equal(r.done, false);
  assert.equal(r.prompt, "cont");
  r = feedInputLine(r.state, "line2");
  assert.equal(r.done, true);
  assert.equal(r.value, "line1 \nline2");
});

test("feedInputLine: 行尾两个反斜杠（偶数）视为字面量，不续行", () => {
  const r = feedInputLine(initialInputState(), "path\\\\");
  assert.equal(r.done, true);
  assert.equal(r.value, "path\\\\");
});

// ---- feedInputLine：三引号块 ----------------------------------------------

test("feedInputLine: 三引号块累积原样行（含空行）直到闭合", () => {
  let r = feedInputLine(initialInputState(), '"""');
  assert.equal(r.done, false);
  assert.equal(r.prompt, "fence");
  r = feedInputLine(r.state, "def foo():");
  assert.equal(r.done, false);
  r = feedInputLine(r.state, "");
  assert.equal(r.done, false);
  r = feedInputLine(r.state, "    return 1");
  assert.equal(r.done, false);
  r = feedInputLine(r.state, '"""');
  assert.equal(r.done, true);
  assert.equal(r.value, "def foo():\n\n    return 1");
});

test("feedInputLine: 三引号块内的反斜杠不触发续行（原样保留）", () => {
  let r = feedInputLine(initialInputState(), '"""');
  r = feedInputLine(r.state, "a \\");
  assert.equal(r.done, false);
  r = feedInputLine(r.state, "b");
  assert.equal(r.done, false);
  r = feedInputLine(r.state, '"""');
  assert.equal(r.done, true);
  assert.equal(r.value, "a \\\nb");
});
