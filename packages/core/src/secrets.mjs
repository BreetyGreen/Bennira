import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rootForScope, globalRoot, SCOPES } from "./scope.mjs";

// secrets.mjs —— 凭证隔离层
// -----------------------------------------------------------------------------
// 盗贼人设：谨慎、不留痕。API key 这类敏感信息：
//   1. 绝不写进 config.json（config.json 可能入库）
//   2. 单独放 .bennira/secrets.json，已被 .gitignore 排除，并 chmod 600
//   3. 读取时环境变量优先——CI / 生产用环境变量注入，本地才落 secrets 文件
//
// 分层：凭证也支持全局层(~/.bennira/secrets.json)。用户在全局配一次 key，
// 所有项目共享；某个项目想用不同 key 时，在项目层单独放一份即可覆盖。
//
// secrets.json 结构：
//   { "model": { "apiKey": "sk-..." } }

const SECRETS_REL = [".bennira", "secrets.json"];

function secretsPath(root) {
  return join(root, ...SECRETS_REL);
}

export function readSecrets(root) {
  try {
    return JSON.parse(readFileSync(secretsPath(root), "utf8"));
  } catch {
    return {};
  }
}

// 只写入本地 secrets 文件，并尽力收紧权限（非 POSIX 平台静默跳过 chmod）。
export function writeSecrets(root, secrets) {
  const dir = join(root, ".bennira");
  mkdirSync(dir, { recursive: true });
  const path = secretsPath(root);
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows 等平台不支持 POSIX 权限，忽略 */
  }
  return path;
}

// —— 多 key 支持 ——————————————————————————————————————————————————
// secrets.json 的 model 字段有两种历史形态，读取时统一归一化：
//   旧（单 key）：{ model: { apiKey: "sk-..." } }
//   新（多 key）：{ model: { keys:[{id,label,provider,apiKey}], activeKeyId, apiKey(镜像) } }
// 归一化把两者都变成 { keys, activeKeyId }：旧结构自动升级为一把名为「默认」的 key，
// 所以老用户的 secrets.json 无需迁移即可继续使用（向后兼容的关键）。
// 写回时把 activeKey 的 apiKey 镜像到 model.apiKey，任何只认旧结构的读者也不受影响。

function normalizeModelSecrets(model) {
  const m = model && typeof model === "object" ? model : {};
  let keys = Array.isArray(m.keys)
    ? m.keys
        .filter((k) => k && typeof k === "object" && typeof k.apiKey === "string" && k.apiKey)
        .map((k) => ({
          id: String(k.id || ""),
          label: String(k.label || ""),
          provider: k.provider ? String(k.provider) : null,
          apiKey: String(k.apiKey),
        }))
    : [];
  // 补齐历史脏数据缺失的 id。
  keys = keys.map((k, i) => (k.id ? k : { ...k, id: `key-${i + 1}` }));

  // 旧单 key：没有 keys 数组但有裸 apiKey → 合成一把「默认」key（无痛升级）。
  if (keys.length === 0 && typeof m.apiKey === "string" && m.apiKey) {
    keys = [{ id: "default", label: "默认", provider: null, apiKey: m.apiKey }];
  }

  const activeKeyId =
    m.activeKeyId && keys.some((k) => k.id === m.activeKeyId)
      ? m.activeKeyId
      : keys[0]
        ? keys[0].id
        : null;

  return { keys, activeKeyId };
}

function activeModelKey(normalized) {
  if (!normalized.keys.length) return null;
  return normalized.keys.find((k) => k.id === normalized.activeKeyId) || normalized.keys[0];
}

// 生成一个未占用的 key id（key-1 / key-2 …）。
function nextKeyId(keys) {
  const used = new Set(keys.map((k) => k.id));
  let n = 1;
  while (used.has(`key-${n}`)) n += 1;
  return `key-${n}`;
}

// 脱敏显示：sk-a…wxyz，只留头尾，绝不整串外泄。
export function maskKey(apiKey) {
  const s = String(apiKey || "");
  if (!s) return "";
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

// 写回归一化后的 model secrets：保留其他顶层字段，并把 activeKey 镜像到 model.apiKey。
function writeModelSecrets(target, normalized) {
  const secrets = readSecrets(target);
  const active = activeModelKey(normalized);
  secrets.model = {
    ...(secrets.model || {}),
    keys: normalized.keys,
    activeKeyId: normalized.activeKeyId,
    apiKey: active ? active.apiKey : "", // 镜像：兼容只认旧结构的读者
  };
  return writeSecrets(target, secrets);
}

// 合并写入模型凭证（保持旧签名）。scope 决定写全局还是项目层（默认全局，
// 因为"配一次 key 到处用"是最常见预期；想项目独立时传 scope: "project"）。
// 语义：更新当前激活的 key（setup 重跑时覆盖而非堆积重复）；无 key 则新建并激活。
export function saveModelApiKey(root, apiKey, { scope = SCOPES.GLOBAL, label, provider } = {}) {
  if (!apiKey) throw new Error("apiKey 不能为空");
  const target = rootForScope(root, scope);
  const norm = normalizeModelSecrets(readSecrets(target).model);
  const active = activeModelKey(norm);
  if (active) {
    active.apiKey = apiKey;
    if (label) active.label = label;
    if (provider) active.provider = provider;
    norm.activeKeyId = active.id;
  } else {
    const id = nextKeyId(norm.keys);
    norm.keys.push({ id, label: label || "默认", provider: provider || null, apiKey });
    norm.activeKeyId = id;
  }
  return writeModelSecrets(target, norm);
}

// 新增一把 key（不覆盖现有），新增即激活（刚加的通常就是想用的）。返回 { id, path }。
export function addModelKey(root, { apiKey, label, provider } = {}, { scope = SCOPES.GLOBAL } = {}) {
  if (!apiKey) throw new Error("apiKey 不能为空");
  const target = rootForScope(root, scope);
  const norm = normalizeModelSecrets(readSecrets(target).model);
  const id = nextKeyId(norm.keys);
  norm.keys.push({
    id,
    label: label || `key-${norm.keys.length + 1}`,
    provider: provider || null,
    apiKey,
  });
  norm.activeKeyId = id;
  const path = writeModelSecrets(target, norm);
  return { id, path };
}

// 列出某层级的 key（脱敏），标注激活项。默认全局层（setup 默认写入处）。
export function listModelKeys(root, { scope = SCOPES.GLOBAL } = {}) {
  const target = rootForScope(root, scope);
  const norm = normalizeModelSecrets(readSecrets(target).model);
  return {
    scope,
    activeKeyId: norm.activeKeyId,
    keys: norm.keys.map((k) => ({
      id: k.id,
      label: k.label,
      provider: k.provider,
      masked: maskKey(k.apiKey),
      active: k.id === norm.activeKeyId,
    })),
  };
}

// 切换激活的 key。id 不存在则抛错。
export function useModelKey(root, id, { scope = SCOPES.GLOBAL } = {}) {
  const target = rootForScope(root, scope);
  const norm = normalizeModelSecrets(readSecrets(target).model);
  if (!norm.keys.some((k) => k.id === id)) {
    throw new Error(`未找到 key：${id}`);
  }
  norm.activeKeyId = id;
  return { path: writeModelSecrets(target, norm), activeKeyId: id };
}

// 删除一把 key；若删的是激活项，自动改激活第一把（没有则置空）。
export function removeModelKey(root, id, { scope = SCOPES.GLOBAL } = {}) {
  const target = rootForScope(root, scope);
  const norm = normalizeModelSecrets(readSecrets(target).model);
  const idx = norm.keys.findIndex((k) => k.id === id);
  if (idx < 0) throw new Error(`未找到 key：${id}`);
  norm.keys.splice(idx, 1);
  if (norm.activeKeyId === id) {
    norm.activeKeyId = norm.keys[0] ? norm.keys[0].id : null;
  }
  writeModelSecrets(target, norm);
  return { removed: id, activeKeyId: norm.activeKeyId };
}

// 解析模型凭证：环境变量 → 项目 secrets → 全局 secrets → none。
// 返回 { apiKey, source, keyId, label } —— source ∈ env | file-project | file-global | none。
// 归一化保证旧单 key 结构也能被读到（升级为「默认」key）。
export function resolveModelCredentials(root) {
  const envKey = process.env.BENNIRA_API_KEY || process.env.OPENAI_API_KEY || "";
  if (envKey) {
    return { apiKey: envKey, source: "env", keyId: null, label: "环境变量" };
  }

  // 项目层优先（允许某项目用不同 key 覆盖全局）。
  const project = normalizeModelSecrets(readSecrets(root).model);
  const pActive = activeModelKey(project);
  if (pActive) {
    return { apiKey: pActive.apiKey, source: "file-project", keyId: pActive.id, label: pActive.label };
  }

  // 回退到全局层（用户在 setup 里默认写这里）。
  const g = globalRoot();
  if (g !== root) {
    const global = normalizeModelSecrets(readSecrets(g).model);
    const gActive = activeModelKey(global);
    if (gActive) {
      return { apiKey: gActive.apiKey, source: "file-global", keyId: gActive.id, label: gActive.label };
    }
  }

  return { apiKey: "", source: "none", keyId: null, label: null };
}

export function hasModelCredentials(root) {
  return resolveModelCredentials(root).apiKey.length > 0;
}

export function isSecretsIgnored(root) {
  // 轻量自检：确认 .gitignore 里排除了 secrets.json
  try {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    return /(^|\n)\s*\.bennira\/secrets\.json\s*(\n|$)/.test(gitignore);
  } catch {
    return false;
  }
}

// 幂等地保证 .gitignore 排除了 secrets.json —— 把"警告用户手动做"升级成"帮用户做好"。
// 盗贼人设：不留痕。凭证绝不能裸奔进 git。
// 返回 { changed, path }：
//   changed=true  表示这次真的写入了保护（新建或追加）
//   changed=false 表示本来就已排除，未改动（幂等）
export function ensureSecretsIgnored(root) {
  const path = join(root, ".gitignore");
  const IGNORE_LINE = ".bennira/secrets.json";

  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = ""; // 文件不存在——下面会创建
  }

  // 已排除则幂等返回，不重复写。
  if (/(^|\n)\s*\.bennira\/secrets\.json\s*(\n|$)/.test(existing)) {
    return { changed: false, path };
  }

  const block = existing && !existing.endsWith("\n") ? "\n" : "";
  const header = existing
    ? `${block}\n# Bennira 凭证：绝不入库\n`
    : "# Bennira 凭证：绝不入库\n";
  writeFileSync(path, `${existing}${header}${IGNORE_LINE}\n`, "utf8");
  return { changed: true, path };
}

export { secretsPath };
