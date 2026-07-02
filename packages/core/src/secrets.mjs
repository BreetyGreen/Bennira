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

// 合并写入模型凭证，保留其他字段。scope 决定写全局还是项目层（默认全局，
// 因为"配一次 key 到处用"是最常见预期；想项目独立时传 scope: "project"）。
export function saveModelApiKey(root, apiKey, { scope = SCOPES.GLOBAL } = {}) {
  const target = rootForScope(root, scope);
  const secrets = readSecrets(target);
  secrets.model = { ...(secrets.model || {}), apiKey };
  return writeSecrets(target, secrets);
}

// 解析模型凭证：环境变量 → 项目 secrets → 全局 secrets → none。
// 返回 { apiKey, source } —— source ∈ env | file-project | file-global | none。
// baseURL / model 属于非敏感配置，由 config.json 提供。
export function resolveModelCredentials(root) {
  const envKey = process.env.BENNIRA_API_KEY || process.env.OPENAI_API_KEY || "";
  if (envKey) {
    return { apiKey: envKey, source: "env" };
  }

  // 项目层优先（允许某项目用不同 key 覆盖全局）。
  const projectKey = readSecrets(root).model?.apiKey || "";
  if (projectKey) {
    return { apiKey: projectKey, source: "file-project" };
  }

  // 回退到全局层（用户在 setup 里默认写这里）。
  const g = globalRoot();
  if (g !== root) {
    const globalKey = readSecrets(g).model?.apiKey || "";
    if (globalKey) {
      return { apiKey: globalKey, source: "file-global" };
    }
  }

  return { apiKey: "", source: "none" };
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
