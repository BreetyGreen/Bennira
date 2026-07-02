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

export const JOB_THEMES = {
  // 盗贼 · 缇利翁（Therion）—— 标志紫围巾，夜行独狼
  thief: {
    id: "thief",
    job: "盗贼",
    character: "缇利翁",
    sigil: "✧",
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

export const DEFAULT_THEME_ID = "thief";

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

export function resolveThemeSpec(config = {}) {
  const themeConfig = config && typeof config.theme === "object" ? config.theme : {};
  const activeId = themeConfig.active || DEFAULT_THEME_ID;
  const custom = themeConfig.custom && typeof themeConfig.custom === "object" ? themeConfig.custom : {};

  const base = custom[activeId] || JOB_THEMES[activeId] || JOB_THEMES[DEFAULT_THEME_ID];
  const overrides =
    themeConfig.overrides && typeof themeConfig.overrides === "object" ? themeConfig.overrides : {};

  const colors = { ...base.colors, ...overrides };
  return {
    id: base.id || activeId,
    job: base.job || "自定义",
    character: base.character || null,
    sigil: base.sigil || GLYPHS.bullet,
    colors,
  };
}

// 创建主题渲染器 -------------------------------------------------------------
//
// 返回一组语义染色函数 + 元信息 + 符号表。展示层只调用 t.brand("...") 之类，
// 不关心底层是否上色。enabled=false 时全部退回原样字符串。

export function createTheme(config = {}, options = {}) {
  const spec = resolveThemeSpec(config);
  const enabled = options.enabled ?? supportsColor(options.env, options.stream);

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
    active: theme.id === activeId,
  }));

  const customList = Object.entries(custom).map(([id, theme]) => ({
    id,
    job: theme.job || "自定义",
    character: theme.character || null,
    sigil: theme.sigil || GLYPHS.bullet,
    brand: (theme.colors && theme.colors.brand) || "#ffffff",
    kind: "custom",
    active: id === activeId,
  }));

  return [...presets, ...customList];
}
