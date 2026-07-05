// prompt.mjs —— 零依赖交互式提示组件（方向键菜单 + 文本输入）
// -----------------------------------------------------------------------------
// 目标：把 setup 从"打字+回车"升级成 Codex / Claude Code 那种方向键上下选的菜单。
// 设计要点：
//   1. 零依赖：只用 process.stdin/stdout + raw mode + ANSI，不引任何三方库。
//   2. 双模安全：
//      - 真 TTY（真人终端）：selectMenu 用 raw mode 捕获单个按键，原地重绘。
//      - 非 TTY（管道 / 测试 / 脚本 / IDE 集成终端无法 setRawMode）：
//        惰性返回默认值，绝不进 raw mode、绝不吞 stdin、绝不挂起。
//   3. 键位宽容：↑↓ 方向键 + vim 的 j/k + 数字直选 + Enter 确认 + Ctrl+C/ESC 取消。
//   4. 清理干净：退出时恢复光标、退出 raw mode、移除监听，不留痕（契合盗贼人设）。
//
// 用法：
//   const scope = await selectMenu("配置写到哪一层？", [
//     { label: "global — 所有项目共享（推荐）", value: "global" },
//     { label: "project — 仅当前项目", value: "project" },
//   ], { stream, input, paint });
//   const url = await textInput("模型 baseURL", { def: "", stream, input });

const ESC = "\u001b";
const CLEAR_LINE = "\r\u001b[K"; // 回到行首 + 清到行尾
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

// 把一段原始输入解码成语义键名。导出以便单测（无需真终端）。
// 返回："up" | "down" | "enter" | "cancel" | "digit:<n>" | "char:<c>" | null
export function decodeKey(input) {
  const s = typeof input === "string" ? input : String(input ?? "");
  if (s === "") return null;

  // Ctrl+C / ESC 单独按下 → 取消
  if (s === "\u0003") return "cancel"; // Ctrl+C
  if (s === "\u0004") return "cancel"; // Ctrl+D
  if (s === ESC) return "cancel"; // 裸 ESC

  // 方向键：ESC [ A/B（部分终端 ESC O A/B）
  if (s === `${ESC}[A` || s === `${ESC}OA`) return "up";
  if (s === `${ESC}[B` || s === `${ESC}OB`) return "down";
  // 左右方向键在单选里等价于上下（宽容）
  if (s === `${ESC}[D` || s === `${ESC}OD`) return "up";
  if (s === `${ESC}[C` || s === `${ESC}OC`) return "down";

  // 回车 / 换行 → 确认
  if (s === "\r" || s === "\n") return "enter";

  // vim 键位
  if (s === "k") return "up";
  if (s === "j") return "down";
  if (s === "q") return "cancel";

  // 数字直选（1-9）
  if (/^[1-9]$/.test(s)) return `digit:${Number(s)}`;

  // 其他可见字符（透传，暂未使用）
  if (s.length === 1 && s >= " ") return `char:${s}`;

  return null;
}

// 归一化选项：字符串 → { label, value }；对象透传（含 disabled/hint）。
function normalizeChoices(choices) {
  return (choices || []).map((c) => {
    if (typeof c === "string") return { label: c, value: c, hint: "", disabled: false };
    return {
      label: c.label ?? String(c.value ?? ""),
      value: c.value ?? c.label,
      hint: c.hint ?? "",
      disabled: c.disabled === true,
    };
  });
}

// 方向键单选菜单。TTY 下交互；非 TTY 惰性返回默认值。
//
// options:
//   stream  输出流（默认 process.stdout）
//   input   输入流（默认 process.stdin）
//   def     默认选中值（value）；未命中则用第一项
//   paint   { pointer, active, dim } 三个染色函数，缺省为恒等
export function selectMenu(question, choices, options = {}) {
  const stream = options.stream || process.stdout;
  const input = options.input || process.stdin;
  const items = normalizeChoices(choices);
  const paint = options.paint || {};
  const pointer = paint.pointer || ((s) => s);
  const active = paint.active || ((s) => s);
  const dim = paint.dim || ((s) => s);
  const heading = paint.heading || ((s) => s);
  // 未选中项的染色：默认走 value token（避免白底一片灰、黑底看不见）。
  // 缺省用 dim 兜底，保证任何情况下都有色可染。
  const item = paint.item || paint.dim || ((s) => s);

  // 起始索引：优先命中 def，且必须落在「可选」项上（跳过 disabled）。
  const isSelectable = (it) => it && it.disabled !== true;
  let index = Math.max(0, items.findIndex((i) => i.value === options.def && isSelectable(i)));
  if (index < 0 || !isSelectable(items[index])) {
    index = items.findIndex(isSelectable);
    if (index < 0) index = 0; // 极端情况：全禁用，退回第 0 项
  }

  // 能否真正交互：需要 TTY 且 stdin 支持 raw mode。
  const canInteract =
    Boolean(stream && stream.isTTY) &&
    Boolean(input && input.isTTY) &&
    typeof input.setRawMode === "function";

  // 非交互（管道 / 测试 / 无法 raw mode）：不碰 stdin，直接返回默认值。
  if (!canInteract) {
    const chosen = items[index] || items[0];
    return Promise.resolve(chosen ? chosen.value : options.def);
  }

  const POINTER = "❯";
  const LOCK = "🔒";
  const lineCount = items.length + 1; // 标题占 1 行

  // 上/下移动时跳过被禁用的项，避免高亮停在锁定项上。
  const step = (from, dir) => {
    let i = from;
    for (let n = 0; n < items.length; n += 1) {
      i = (i + dir + items.length) % items.length;
      if (isSelectable(items[i])) return i;
    }
    return from; // 全禁用则不动
  };

  function render(first) {
    if (!first) {
      // 光标上移覆盖上一次的整块菜单
      stream.write(`${ESC}[${lineCount}A`);
    }
    stream.write(`${CLEAR_LINE}${heading(question)}\n`);
    items.forEach((it, i) => {
      const selected = i === index;
      const disabled = it.disabled === true;
      const bullet = selected ? pointer(POINTER) : " ";
      const num = dim(`${i + 1}.`);
      // 三态染色：选中→active(亮)，禁用→dim(灰)，普通→item(value 色，任何背景可见)。
      const rawLabel = disabled ? `${it.label} ${LOCK}` : it.label;
      const label = selected ? active(rawLabel) : disabled ? dim(rawLabel) : item(rawLabel);
      const hint = it.hint ? ` ${dim(it.hint)}` : "";
      stream.write(`${CLEAR_LINE}${bullet} ${num} ${label}${hint}\n`);
    });
  }

  return new Promise((resolve) => {
    let done = false;
    stream.write(HIDE_CURSOR);
    render(true);

    const cleanup = () => {
      if (done) return;
      done = true;
      input.removeListener("data", onData);
      try {
        input.setRawMode(false);
      } catch {}
      input.pause();
      stream.write(SHOW_CURSOR);
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const onData = (buf) => {
      const key = decodeKey(buf.toString("utf8"));
      if (!key) return;
      if (key === "up") {
        index = step(index, -1);
        render(false);
      } else if (key === "down") {
        index = step(index, +1);
        render(false);
      } else if (key.startsWith("digit:")) {
        const n = Number(key.slice(6));
        if (n >= 1 && n <= items.length && isSelectable(items[n - 1])) {
          index = n - 1;
          render(false);
        }
      } else if (key === "enter") {
        // 落在禁用项上时不确认（理论上 index 永远在可选项，双保险）。
        if (isSelectable(items[index])) {
          finish(items[index] ? items[index].value : options.def);
        }
      } else if (key === "cancel") {
        // 取消 = 用当前高亮项（对 setup 更友好，不中断流程）。
        finish(isSelectable(items[index]) ? items[index].value : options.def);
      }
    };

    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

// 自由文本输入。TTY 用 readline 逐问；非 TTY 惰性返回默认值。
// 复用 readline 是因为文本编辑（退格 / 粘贴 / 输入法）比自己处理 raw 字节稳得多。
export function textInput(question, options = {}) {
  const stream = options.stream || process.stdout;
  const input = options.input || process.stdin;
  const def = options.def ?? "";
  const paint = options.paint || {};
  const label = paint.label || ((s) => s);
  const dim = paint.dim || ((s) => s);
  const mask = options.mask === true; // key 输入可选择不回显（此处仅占位，readline 不原生支持）

  const canInteract = Boolean(stream && stream.isTTY) && Boolean(input && input.isTTY);
  if (!canInteract) {
    return Promise.resolve(def);
  }

  return new Promise((resolve) => {
    // 延迟 import 避免非交互路径也创建 readline。
    import("node:readline").then(({ createInterface }) => {
      const rl = createInterface({ input, output: stream });
      const hint = def ? dim(`（默认 ${def}）`) : "";
      rl.question(`${label(question)} ${hint}\n  `, (answer) => {
        rl.close();
        resolve((answer || "").trim() || def);
      });
    });
  });
}
