import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configChain, rootForScope, SCOPES } from "./scope.mjs";

export function ensureProjectMemory(root, inspectResult) {
  const dir = join(root, ".bennira");
  mkdirSync(join(dir, "logs"), { recursive: true });

  // 项目层 config 只存"覆盖全局的差异"，不再固化全部默认值——
  // 否则一个空 baseURL 会反过来把全局的真配置覆盖成空。
  // 首次建项目时给一个空对象占位，真正的默认值由 readConfig 在读取时叠加。
  const configPath = join(dir, "config.json");
  if (!existsSync(configPath)) {
    writeJson(configPath, {});
  }

  const previousState = readProjectMemory(root);
  const state = buildState(inspectResult, previousState);
  writeProjectMemory(root, state);
  return state;
}

export function readProjectMemory(root) {
  const statePath = join(root, ".bennira", "state.json");
  return readJson(statePath);
}

export function writeProjectMemory(root, state) {
  const dir = join(root, ".bennira");
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "state.json");
  writeJson(statePath, state);
}

export function updateProjectMemory(root, patch) {
  const previous = readProjectMemory(root) ?? {};
  const state = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeProjectMemory(root, state);
  return state;
}

function defaultConfig() {
  return {
    language: "zh-CN",
    versionLine: "小偷",
    defaultMode: "plan-first",
    permissions: {
      read: "allow",
      write: "confirm",
      execute: "deny",
      network: "deny",
    },
    sensitivePatterns: [".env", ".env.*", "secrets/**", "*.pem", "*.key"],
    // 模型接入（非敏感部分）。apiKey 不在这里——它在 .bennira/secrets.json（gitignore）。
    model: {
      provider: "openai-compatible",
      baseURL: "",
      model: "",
      // 生成参数，保守默认。
      temperature: 0.3,
      maxTokens: 1200,
      timeoutMs: 60000,
    },
    theme: {
      // 一代「小偷」默认盗贼紫（缇利翁）。切换版本线时改这里或用 `bennira theme use`。
      active: "thief",
      // 对当前主题的 token 局部覆盖，例如 { "accent": "#f0f" }
      overrides: {},
      // 完全自定义主题，可多套：{ "<id>": { job, sigil, colors: {...} } }
      custom: {},
    },
  };
}

function buildState(inspectResult, previousState) {
  const prev = previousState ?? {};
  return {
    ...prev,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    projectRoot: inspectResult.root,
    versionLine: "Bennira 一代 - 小偷",
    stage: "小偷 Alpha",
    packageKind: inspectResult.packageKind,
    isGitRepo: inspectResult.isGitRepo,
    docs: inspectResult.docs.map((doc) => ({
      path: doc.path,
      exists: doc.exists,
      title: doc.title ?? null,
    })),
    lastAction: prev.lastAction ?? null,
    lastPlanPath: prev.lastPlanPath ?? ".bennira/last-plan.md",
    handoffPath: prev.handoffPath ?? "docs/HANDOFF.md",
    nextSteps: prev.nextSteps ?? [
      "继续完善小偷 Alpha 的 Context Reader 和项目状态摘要。",
      "运行 `bennira handoff` 刷新跨工具交接文档。",
    ],
    nextSuggestedCommands: [
      "bennira inspect",
      "bennira plan \"我想继续推进这个项目\"",
      "bennira status",
      "bennira handoff",
    ],
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeDefaults(value, defaults) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const output = { ...value };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (output[key] === undefined) {
      output[key] = defaultValue;
    } else if (
      defaultValue &&
      typeof defaultValue === "object" &&
      !Array.isArray(defaultValue)
    ) {
      output[key] = mergeDefaults(output[key], defaultValue);
    }
  }
  return output;
}

// 两个配置层之间的深合并：upper 覆盖 base，对象递归合并，数组/标量整体替换。
// 与 mergeDefaults 的区别：这里没有"默认值"概念，upper 里显式出现的键才生效，
// 所以项目层只需存差异，不会用一堆默认值意外覆盖全局层。
function mergeLayer(base, upper) {
  if (!upper || typeof upper !== "object" || Array.isArray(upper)) {
    return base;
  }
  const output = { ...base };
  for (const [key, val] of Object.entries(upper)) {
    if (
      val &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      output[key] &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeLayer(output[key], val);
    } else {
      output[key] = val;
    }
  }
  return output;
}

// 配置读写 -------------------------------------------------------------------
//
// 分层模型：默认值 → 全局层(~/.bennira) → 项目层(<project>/.bennira)，
// 后者深合并覆盖前者。项目层只存差异，读取时才叠加成完整配置。

// 读取某一层的原始 config（不叠加默认值，用于写回时只改这一层）。
export function readRawConfig(root) {
  return readJson(join(root, ".bennira", "config.json")) ?? {};
}

// 读取"有效配置"：沿作用域链逐层深合并，最后铺上默认值兜底。
export function readConfig(root) {
  let merged = {};
  for (const layerRoot of configChain(root)) {
    merged = mergeLayer(merged, readRawConfig(layerRoot));
  }
  // 默认值作为最底层兜底：已有的键保留，缺的补上。
  return mergeDefaults(merged, defaultConfig());
}

// 写回某一层的原始 config（默认写项目层，可指定 global）。
export function writeConfig(root, config, { scope = SCOPES.PROJECT } = {}) {
  const target = rootForScope(root, scope);
  const dir = join(target, ".bennira");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "config.json"), config);
  return config;
}

// 主题配置更新：切换 active、局部覆盖 token、注册自定义主题、清除覆盖 -------------
//
// scope 决定写哪一层（默认项目层）。读的是"该层原始值"而非有效配置，
// 这样只把用户这次的改动落进该层，不会把继承自全局的值固化下来。
//
// patch 支持：
//   { active: "warrior" }
//   { override: { token: "accent", color: "#f0f" } }
//   { resetOverrides: true }
//   { custom: { id: "midnight", theme: { job, sigil, colors } } }
export function updateThemeConfig(root, patch = {}, { scope = SCOPES.PROJECT } = {}) {
  const target = rootForScope(root, scope);
  const config = readRawConfig(target);
  const theme = { active: "thief", overrides: {}, custom: {}, ...(config.theme || {}) };

  if (typeof patch.active === "string" && patch.active) {
    theme.active = patch.active;
  }
  if (patch.override && typeof patch.override === "object") {
    theme.overrides = { ...theme.overrides, [patch.override.token]: patch.override.color };
  }
  if (patch.resetOverrides) {
    theme.overrides = {};
  }
  if (patch.custom && typeof patch.custom === "object" && patch.custom.id) {
    theme.custom = { ...theme.custom, [patch.custom.id]: patch.custom.theme };
  }

  config.theme = theme;
  writeConfig(root, config, { scope });
  return config;
}

// 模型配置更新（非敏感）。apiKey 请用 secrets.saveModelApiKey，别传进这里。
export function updateModelConfig(root, patch = {}, { scope = SCOPES.PROJECT } = {}) {
  const target = rootForScope(root, scope);
  const config = readRawConfig(target);
  config.model = { ...(config.model || {}), ...patch };
  // 防御：即便误传 apiKey 也不落进 config.json
  delete config.model.apiKey;
  writeConfig(root, config, { scope });
  return config;
}

// 权限更新：显式开关某项权限（如 network）。
export function updatePermission(root, key, value, { scope = SCOPES.PROJECT } = {}) {
  const target = rootForScope(root, scope);
  const config = readRawConfig(target);
  config.permissions = { ...(config.permissions || {}), [key]: value };
  writeConfig(root, config, { scope });
  return config;
}
