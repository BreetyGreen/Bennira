// input-support.mjs —— REPL 输入侧的可测纯逻辑（多行输入 / @文件引用 / 合并补全）
// -----------------------------------------------------------------------------
// 这是 Bennira 补齐"输入侧"体验的地基。对齐 Codex / Claude Code 的两件事：
//   1. 多行输入：反斜杠续行（\）与三引号块（"""）——粘一段代码不再被回车拆断。
//   2. @文件引用：输入里写 @path，提交时把文件内容作为独立上下文块喂给模型。
//
// 设计原则（和 repl-support.mjs 一致）：
//   - 这一层只做纯数据变换，不碰 readline / fs——离线可单测。
//   - 真正的文件读取、readline 绑定在 CLI 层做（CLI 提供 fileList / readFile）。
//
// 为什么不抄 Claude Code 的做法逐字节？因为它基于 Ink（React for CLI），能拿到
// Shift+Enter、bracketed-paste 这些底层按键；而我们基于 node:readline，只能按"整行"
// 处理。所以我们用 readline 能可靠实现的两种约定——反斜杠续行 + 三引号块——来覆盖
// "手动换行"和"粘贴大段代码"两个核心场景，行为对齐、实现更稳。

// ---- @文件引用：提取 ------------------------------------------------------

// 提取一行/一段文本里的 @path 引用。遵循 Claude Code 的规则：
//   @ 必须在行首或紧跟空白，避免把邮箱 a@b.com、装饰符 foo@bar 误判成引用。
// 支持两种写法：
//   @path/to/file        —— 普通路径（到空白为止）
//   @"path with space"   —— 含空格的路径用双引号包裹
// 返回去重后的路径数组（保持出现顺序）。
export function extractAtMentions(text) {
  const s = String(text ?? "");
  const found = [];
  // (^|\s) 保证 @ 前是行首或空白；随后要么是 "..." 引号串，要么是非空白串。
  const re = /(^|\s)@(?:"([^"]+)"|([^\s"]+))/gu;
  let m;
  while ((m = re.exec(s)) !== null) {
    const raw = m[2] !== undefined ? m[2] : m[3];
    if (!raw) continue;
    // 去掉路径尾部可能粘连的标点（句读 / 逗号 / 分号 / 右括号），但保留扩展名的点。
    const cleaned = raw.replace(/[，。；、）)\].,;]+$/u, "");
    if (cleaned && !found.includes(cleaned)) found.push(cleaned);
  }
  return found;
}

// 判断某个 token 是否处于"正在敲 @引用"的状态（供补全用）。
// 返回 { active, prefix }：active 表示行尾正处于一个 @token；prefix 是 @ 之后已敲的部分。
export function atTokenAtEnd(line) {
  const s = String(line ?? "");
  const atIdx = s.lastIndexOf("@");
  if (atIdx === -1) return { active: false, prefix: "" };
  // @ 前必须是行首或空白。
  if (atIdx > 0 && !/\s/.test(s[atIdx - 1])) return { active: false, prefix: "" };
  const after = s.slice(atIdx + 1);
  // @ 之后若已经出现空白，说明这个引用已敲完，不再处于补全状态。
  if (/\s/.test(after) || after.includes('"')) return { active: false, prefix: "" };
  return { active: true, prefix: after, atIndex: atIdx };
}

// ---- 补全：@文件 + slash 合并 --------------------------------------------

// @文件补全：给定当前行与候选文件列表，返回 [completions, line]（readline 约定）。
// 仅当行尾处于 @token 时生效；completions 是"整行替换候选"（把 @prefix 换成 @完整路径）。
export function atFileCompleter(line, fileList = []) {
  const s = String(line ?? "");
  const tok = atTokenAtEnd(s);
  if (!tok.active) return [[], s];
  const prefix = tok.prefix.toLowerCase();
  const head = s.slice(0, tok.atIndex); // @ 之前的部分（保留）
  const matches = [];
  for (const f of fileList) {
    const path = String(f);
    // 子串模糊匹配（前缀优先在排序时体现）：空 prefix 时全列（受上限约束）。
    if (!prefix || path.toLowerCase().includes(prefix)) {
      const quoted = /\s/.test(path) ? `@"${path}"` : `@${path}`;
      matches.push(`${head}${quoted}`);
    }
  }
  // 前缀命中排在子串命中前面，体验更顺。
  matches.sort((a, b) => {
    const pa = a.toLowerCase().indexOf(prefix, head.length);
    const pb = b.toLowerCase().indexOf(prefix, head.length);
    return pa - pb;
  });
  return [matches, s];
}

// ---- 多行输入状态机 -------------------------------------------------------

// 初始输入状态。REPL 每次开始收集一条"逻辑输入"时重置。
export function initialInputState() {
  return { mode: "normal", buffer: [], fence: null };
}

// 喂入一整行（readline 的一次 line 事件），返回 { state, done, value, prompt }：
//   - done=false：还在累积（多行未结束），prompt 提示当前应显示的续行提示符类型。
//   - done=true ：一条逻辑输入结束，value 是拼好的最终文本（可能含 \n）。
//
// 三种规则：
//   1. 三引号块：单独一行 """ 进入块模式，再遇到 """ 结束——块内所有行原样保留（含空行）。
//   2. 反斜杠续行：普通模式下行尾是单个 \ → 去掉 \，续下一行。
//   3. 普通：其余情况一行即一条输入。
export function feedInputLine(state, rawLine) {
  const st = state && typeof state === "object" ? state : initialInputState();
  const line = String(rawLine ?? "");

  // --- 三引号块模式 ---
  if (st.mode === "fence") {
    if (line.trim() === '"""') {
      const value = st.buffer.join("\n");
      return { state: initialInputState(), done: true, value };
    }
    st.buffer.push(line);
    return { state: st, done: false, prompt: "fence" };
  }

  // 进入三引号块：这一行"只有" """（允许后面直接跟内容，如 """foo）
  const trimmed = line.trimEnd();
  if (st.mode === "normal" && st.buffer.length === 0 && trimmed === '"""') {
    return { state: { mode: "fence", buffer: [], fence: '"""' }, done: false, prompt: "fence" };
  }

  // --- 反斜杠续行 ---
  // 行尾恰好是奇数个反斜杠时视为续行（偶数个是转义的字面反斜杠，不续）。
  const backslashes = line.match(/\\+$/);
  if (backslashes && backslashes[0].length % 2 === 1) {
    const withoutSlash = line.slice(0, -1); // 去掉末尾那个续行反斜杠
    st.buffer.push(withoutSlash);
    return { state: st, done: false, prompt: "cont" };
  }

  // --- 普通提交 ---
  st.buffer.push(line);
  const value = st.buffer.join("\n");
  return { state: initialInputState(), done: true, value };
}
