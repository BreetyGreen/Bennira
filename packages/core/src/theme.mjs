// Bennira CLI 主题系统
//
// 设计原则（对齐项目工程原则）：
// - 零依赖：只用原生 ANSI 转义序列，不引 chalk / ink。
// - 可降级：非 TTY、NO_COLOR、dumb 终端自动退回纯文本，绝不污染管道和 --json。
// - 可扩展：配色按《八方旅人》职业组织，一代「小偷」默认盗贼紫，后续职业只需加一条预设。
// - 可自定义：用户可在 .bennira/config.json 覆盖任意语义 token，或整套自定义主题。
//
// 语义 token（展示层只认这些语义，不直接写颜色）：
//   brand    品牌 / 主标题       —— 当前职业的标志色
//   accent   强调 / 命令名 / 高亮
//   heading  次级标题 / 分组名
//   label    键名 / 字段名
//   value    键值 / 正文
//   muted    次要信息 / 时间戳 / 计数
//   success  成功状态
//   warning  警告
//   danger   风险 / 错误
//   info     提示 / 中性信息

// 8-bit / truecolor 转义拼装 -------------------------------------------------

const RESET = "\u001b[0m";

function fg(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `\u001b[38;2;${r};${g};${b}m`;
}

function hexToRgb(hex) {
  const clean = String(hex).replace(/^#/, "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";

// 职业预设配色 ---------------------------------------------------------------
//
// 每套主题给出 9 个语义 token 的十六进制色值，外加一个标志符号 sigil 和中文职业名。
// 一代只锁定「盗贼」，其余职业先占位预设，未来切换版本线时可直接启用。

// 默认主题 id。提前声明：下方 JOB_THEMES 定义后的「解锁归一化」循环要用到它，
// 若放在文件末尾会因 TDZ 在模块加载时报 ReferenceError。
export const DEFAULT_THEME_ID = "thief";

export const JOB_THEMES = {
  // 盗贼 · 缇利翁（Therion）—— 标志紫围巾，夜行独狼
  // 一代唯一开放（unlocked:true）。其余职业占位、锁定，切换时会被拦下。
  thief: {
    id: "thief",
    job: "盗贼",
    character: "缇利翁",
    sigil: "✧",
    unlocked: true,
    // 深色终端盘：value/heading 偏亮，在黑底上跳出来。
    colors: {
      brand: "#9B6BD8", // 盗贼紫
      accent: "#C39BF0",
      heading: "#B98CE8",
      label: "#8A7CA8",
      value: "#E6E1F0",
      muted: "#6E6285",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
    // 浅色终端盘：同一套盗贼紫的「深色版」，在白底上对比足够。
    // 关键点：value/heading/accent 全部压深，muted 用中灰，避免白底一片灰看不清。
    colorsLight: {
      brand: "#6D3AB0", // 更深的盗贼紫，白底醒目
      accent: "#7A3FC0",
      heading: "#5E2E9E",
      label: "#5A4A78",
      value: "#241C33", // 近黑带紫，正文主色
      muted: "#7A6E92", // 中灰紫，白底可辨
      success: "#1F8B4C",
      warning: "#9A6B00",
      danger: "#C0392B",
      info: "#2E6DB4",
    },
  },
  // 剑士 · 欧贝里克（Olberic）—— 钢铁与炽红
  warrior: {
    id: "warrior",
    job: "剑士",
    character: "欧贝里克",
    sigil: "⚔",
    colors: {
      brand: "#C6483C",
      accent: "#E27A6E",
      heading: "#D25A4C",
      label: "#9A7A74",
      value: "#F0E4E2",
      muted: "#7A6460",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E5544A",
      info: "#8FB8E8",
    },
  },
  // 商人 · 特雷莎（Tressa）—— 金币与航海黄
  merchant: {
    id: "merchant",
    job: "商人",
    character: "特雷莎",
    sigil: "❈",
    colors: {
      brand: "#E0A93B",
      accent: "#F2C868",
      heading: "#E8B84E",
      label: "#9A8A60",
      value: "#F2ECDC",
      muted: "#7A6E4E",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
  // 猎人 · 哈妮特（H'aanit）—— 森林绿
  hunter: {
    id: "hunter",
    job: "猎人",
    character: "哈妮特",
    sigil: "➹",
    colors: {
      brand: "#4FA36B",
      accent: "#7FC894",
      heading: "#5FB37B",
      label: "#6E8A74",
      value: "#E2F0E6",
      muted: "#5A6E5E",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
  // 药师 · 阿尔菲恩（Alfyn）—— 药草青绿
  apothecary: {
    id: "apothecary",
    job: "药师",
    character: "阿尔菲恩",
    sigil: "✚",
    colors: {
      brand: "#3FA8A0",
      accent: "#6FCDC6",
      heading: "#4FB8B0",
      label: "#6E8A88",
      value: "#E0F0EE",
      muted: "#556E6C",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
  // 舞娘 · 普利姆罗塞（Primrose）—— 妖冶玫红
  dancer: {
    id: "dancer",
    job: "舞娘",
    character: "普利姆罗塞",
    sigil: "✦",
    colors: {
      brand: "#D45A96",
      accent: "#EE8BB8",
      heading: "#E06BA4",
      label: "#9A7088",
      value: "#F2E2EC",
      muted: "#7A5A6E",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
  // 学者 · 塞勒斯（Cyrus）—— 智慧蓝
  scholar: {
    id: "scholar",
    job: "学者",
    character: "塞勒斯",
    sigil: "❋",
    colors: {
      brand: "#4A7FD0",
      accent: "#7FA8E8",
      heading: "#5A8FDA",
      label: "#6E7C9A",
      value: "#E2E8F2",
      muted: "#556080",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
  // 神官 · 欧菲莉亚（Ophilia）—— 圣光淡金
  cleric: {
    id: "cleric",
    job: "神官",
    character: "欧菲莉亚",
    sigil: "✟",
    colors: {
      brand: "#E8D48A",
      accent: "#F2E6B0",
      heading: "#ECDC98",
      label: "#9A9270",
      value: "#F4F0E2",
      muted: "#7A745A",
      success: "#7FD6A6",
      warning: "#E8C06B",
      danger: "#E07B7B",
      info: "#8FB8E8",
    },
  },
};

// 一代版本线只开放盗贼。其余职业配色已写好、但锁定；未显式标 unlocked 的一律视为锁定。
// 用「定义后归一化」而非逐条硬写，既不动上面的色值，又保证唯一真源。
for (const [id, theme] of Object.entries(JOB_THEMES)) {
  if (typeof theme.unlocked !== "boolean") {
    theme.unlocked = id === DEFAULT_THEME_ID;
  }
}

// 某职业是否在本代开放。custom 主题一律视为开放（用户自己造的）。
export function isThemeUnlocked(id) {
  const preset = JOB_THEMES[id];
  if (!preset) return true; // 非预设（自定义）→ 不拦
  return preset.unlocked === true;
}

// 语义符号（不吃颜色，纯文本也保留辨识度）--------------------------------------

export const GLYPHS = {
  bullet: "•",
  arrow: "→",
  found: "✓",
  missing: "✗",
  warn: "!",
  branch: "├─",
  branchEnd: "└─",
  chevron: "›",
};

// 按终端显示宽度补齐（CJK 字符占 2 列）。避免中文行右侧错位。
export function displayWidth(str) {
  let width = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    // 常见 CJK / 全角区间按 2 列计。
    const wide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK 部首 ~ 彝文
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul 音节
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容
      (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
      (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

export function padDisplay(str, target) {
  const pad = target - displayWidth(str);
  return pad > 0 ? String(str) + " ".repeat(pad) : String(str);
}

// 颜色能力探测 ---------------------------------------------------------------

export function supportsColor(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return false;
  }
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") {
    return true;
  }
  if (env.TERM === "dumb") {
    return false;
  }
  // 非 TTY（重定向到文件 / 管道 / --json 场景）一律降级为纯文本。
  return Boolean(stream && stream.isTTY);
}

// 终端背景明暗探测 -----------------------------------------------------------
//
// 大多数终端会设 COLORFGBG 环境变量，格式 "fg;bg"（如 "15;0" 白字黑底、
// "0;15" 黑字白底），末位是背景色索引。索引 0-6、8 视为深色，7、9-15 视为浅色。
// 探测不到（很多 IDE 集成终端不设）返回 "unknown"，上层按深色兜底 —— 这样
// 既能自动适配白底终端，又保证探测失败时行为与旧版完全一致，不影响现有测试。
const DARK_BG_INDEXES = new Set([0, 1, 2, 3, 4, 5, 6, 8]);

export function detectBackground(env = process.env) {
  const raw = env.COLORFGBG;
  if (typeof raw === "string" && raw.includes(";")) {
    const parts = raw.split(";");
    const bg = Number(parts[parts.length - 1].trim());
    if (Number.isInteger(bg)) {
      return DARK_BG_INDEXES.has(bg) ? "dark" : "light";
    }
  }
  return "unknown";
}

// OSC 11 背景色查询 ----------------------------------------------------------
//
// COLORFGBG 只有 iTerm2/konsole 等少数终端会设，macOS Terminal.app 根本不设，
// 导致 detectBackground 永远 unknown、浅色适配从不触发。更可靠的办法是 OSC 11：
// 向终端写 `ESC ] 11 ; ? BEL`，支持的终端（含 Terminal.app / iTerm2 / kitty /
// Windows Terminal 等）会回 `ESC ] 11 ; rgb:RRRR/GGGG/BBBB ESC \`（或 BEL 收尾）。
// 据回传的 RGB 算相对亮度即可判明暗，不依赖任何环境变量。

// 解析 OSC 11 应答，抽出背景 RGB 并判明暗。纯函数、可单测（无需真终端）。
// 兼容 16-bit（rgb:ffff/ffff/ffff）与 8-bit（rgb:ff/ff/ff）两种位宽。
export function parseOsc11Response(raw) {
  if (typeof raw !== "string") return "unknown";
  // 允许应答里夹杂其他转义；只抓 rgb:XXXX/XXXX/XXXX 片段。
  const m = raw.match(/rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/);
  if (!m) return "unknown";
  const toByte = (hex) => {
    // 各通道位宽可能是 1~4 个 hex 位，统一归一化到 0-255。
    const v = parseInt(hex, 16);
    const max = 16 ** hex.length - 1;
    if (!Number.isFinite(v) || max <= 0) return 0;
    return Math.round((v / max) * 255);
  };
  const r = toByte(m[1]);
  const g = toByte(m[2]);
  const b = toByte(m[3]);
  // 相对亮度（sRGB 感知加权）。阈值 128：偏亮=浅底，偏暗=深底。
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance >= 128 ? "light" : "dark";
}

// 向终端发 OSC 11 查询并读回应答，判定背景明暗。异步，带超时兜底。
// 探测不到 / 非 TTY / 超时 → "unknown"，上层按深色兜底（行为与旧版一致）。
// 关键：查询期间临时进 raw mode 抓单次应答，结束立即恢复，绝不吞用户输入。
export function queryTerminalBackground(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const timeoutMs = options.timeoutMs ?? 120;

  return new Promise((resolve) => {
    // 前置守卫：任一端非 TTY，或无法进 raw mode，直接放弃（不阻塞、不报错）。
    if (
      !input ||
      !output ||
      !input.isTTY ||
      !output.isTTY ||
      typeof input.setRawMode !== "function" ||
      typeof output.write !== "function"
    ) {
      resolve("unknown");
      return;
    }

    let settled = false;
    let buffer = "";
    const prevRaw = input.isRaw;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      input.removeListener("data", onData);
      try {
        if (!prevRaw) input.setRawMode(false);
      } catch {
        /* 忽略：某些环境 setRawMode 可能抛错 */
      }
      // 查询期间我们 resume 了 stdin；若原本是暂停态则恢复暂停，避免误吞后续输入。
      if (options.pauseAfter !== false) {
        try {
          input.pause();
        } catch {
          /* noop */
        }
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onData = (chunk) => {
      buffer += chunk.toString("latin1");
      // 收到完整的 OSC 11 应答（ST=ESC\ 或 BEL 收尾）即可解析。
      if (/rgb:[0-9a-fA-F]+\/[0-9a-fA-F]+\/[0-9a-fA-F]+/.test(buffer)) {
        finish(parseOsc11Response(buffer));
      }
    };

    try {
      input.setRawMode(true);
      input.resume();
      input.on("data", onData);
      // OSC 11 查询序列：ESC ] 11 ; ? BEL
      output.write("\u001b]11;?\u0007");
    } catch {
      finish("unknown");
      return;
    }

    timer = setTimeout(() => finish(buffer ? parseOsc11Response(buffer) : "unknown"), timeoutMs);
  });
}

// 决定用深色盘还是浅色盘。优先级：
//   config.theme.appearance（用户手动锁定）> options.background（OSC11/COLORFGBG 实测）> 深色兜底。
// 手动值最强：即便探测说深色，用户显式设 light 也照切（透明终端 / 探测误判时的逃生口）。
// 无任何信号 → 深色，保证 resolveThemeSpec({}) 恒为深色盘（brand #9b6bd8），不破坏既有契约。
function resolveAppearance(themeConfig, options) {
  const pref = themeConfig && themeConfig.appearance;
  if (pref === "light" || pref === "dark") return pref;
  const explicit = options.background;
  if (explicit === "light" || explicit === "dark") return explicit;
  return "dark";
}

// 主题解析：预设 + config 覆盖 + 用户自定义 -----------------------------------
//
// config.theme 形如：
// {
//   "active": "thief",              // 当前启用的主题 id（预设或自定义）
//   "overrides": { "accent": "#f0f" }, // 对当前主题的 token 局部覆盖
//   "custom": {                     // 完全自定义主题，可多套
//     "midnight": { "job": "自定义", "sigil": "★", "colors": { ... } }
//   }
// }

export function resolveThemeSpec(config = {}, options = {}) {
  const themeConfig = config && typeof config.theme === "object" ? config.theme : {};
  const activeId = themeConfig.active || DEFAULT_THEME_ID;
  const custom = themeConfig.custom && typeof themeConfig.custom === "object" ? themeConfig.custom : {};

  const base = custom[activeId] || JOB_THEMES[activeId] || JOB_THEMES[DEFAULT_THEME_ID];
  const overrides =
    themeConfig.overrides && typeof themeConfig.overrides === "object" ? themeConfig.overrides : {};

  // 明暗盘选择：浅色背景且该主题提供了 colorsLight 才切浅色盘，否则用深色盘。
  // 无 options（如纯 resolveThemeSpec({})）→ appearance=dark → 恒走 base.colors。
  const appearance = resolveAppearance(themeConfig, options);
  const palette =
    appearance === "light" && base.colorsLight ? base.colorsLight : base.colors;

  const colors = { ...palette, ...overrides };
  return {
    id: base.id || activeId,
    job: base.job || "自定义",
    character: base.character || null,
    sigil: base.sigil || GLYPHS.bullet,
    appearance,
    colors,
  };
}

// 创建主题渲染器 -------------------------------------------------------------
//
// 返回一组语义染色函数 + 元信息 + 符号表。展示层只调用 t.brand("...") 之类，
// 不关心底层是否上色。enabled=false 时全部退回原样字符串。

export function createTheme(config = {}, options = {}) {
  const enabled = options.enabled ?? supportsColor(options.env, options.stream);

  // 背景明暗：显式 options.background 优先；否则在启用颜色时自动探测 COLORFGBG；
  // 探测不到 → 深色（与旧版一致）。降级为纯文本时明暗无意义，不探测。
  let background = options.background;
  if (background !== "light" && background !== "dark") {
    const detected = enabled ? detectBackground(options.env || process.env) : "unknown";
    background = detected === "light" ? "light" : undefined; // 只有确切浅色才切，其余交给 resolveAppearance 兜底为 dark
  }

  const spec = resolveThemeSpec(config, { background });

  const paint = (hex, { bold = false, dim = false } = {}) => {
    return (text) => {
      const str = String(text);
      if (!enabled) return str;
      const prefix = `${bold ? BOLD : ""}${dim ? DIM : ""}${fg(hex)}`;
      return `${prefix}${str}${RESET}`;
    };
  };

  const c = spec.colors;

  return {
    enabled,
    id: spec.id,
    job: spec.job,
    character: spec.character,
    sigil: spec.sigil,
    appearance: spec.appearance,
    glyphs: GLYPHS,
    colors: c,

    brand: paint(c.brand, { bold: true }),
    accent: paint(c.accent, { bold: true }),
    heading: paint(c.heading, { bold: true }),
    label: paint(c.label),
    value: paint(c.value),
    muted: paint(c.muted, { dim: true }),
    success: paint(c.success, { bold: true }),
    warning: paint(c.warning, { bold: true }),
    danger: paint(c.danger, { bold: true }),
    info: paint(c.info),

    // 组合辅助：键值行
    kv(key, value) {
      return `${this.label(key)}${this.muted("：")}${this.value(value)}`;
    },
    // 组合辅助：品牌标题带职业标志
    title(text) {
      return `${this.brand(`${this.sigil} ${text}`)}`;
    },
  };
}

// 列出所有可用主题（预设 + 自定义），供 `theme list` 用 --------------------------

export function listThemes(config = {}) {
  const themeConfig = config && typeof config.theme === "object" ? config.theme : {};
  const custom = themeConfig.custom && typeof themeConfig.custom === "object" ? themeConfig.custom : {};
  const activeId = themeConfig.active || DEFAULT_THEME_ID;

  const presets = Object.values(JOB_THEMES).map((theme) => ({
    id: theme.id,
    job: theme.job,
    character: theme.character,
    sigil: theme.sigil,
    brand: theme.colors.brand,
    kind: "preset",
    unlocked: theme.unlocked === true,
    active: theme.id === activeId,
  }));

  const customList = Object.entries(custom).map(([id, theme]) => ({
    id,
    job: theme.job || "自定义",
    character: theme.character || null,
    sigil: theme.sigil || GLYPHS.bullet,
    brand: (theme.colors && theme.colors.brand) || "#ffffff",
    kind: "custom",
    unlocked: true,
    active: id === activeId,
  }));

  return [...presets, ...customList];
}
