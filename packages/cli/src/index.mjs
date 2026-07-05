#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvent,
  buildInitMessages,
  buildPlanMessages,
  createProvider,
  createTheme,
  createSpinner,
  ensureProjectMemory,
  formatEvents,
  formatInspectResult,
  formatPlan,
  formatPlanMarkdown,
  formatStatus,
  formatThemeList,
  formatThemeShow,
  inspectWorkspace,
  isSecretsIgnored,
  ensureSecretsIgnored,
  JOB_THEMES,
  isThemeUnlocked,
  listModels,
  builtinModels,
  mergeModelLists,
  maskKey,
  addModelKey,
  listModelKeys,
  useModelKey,
  removeModelKey,
  modelReadiness,
  padDisplay,
  parsePlanResponse,
  PROVIDER_PRESETS,
  findProviderPreset,
  readConfig,
  readEventLog,
  readProjectMemory,
  saveModelApiKey,
  SCOPES,
  selectMenu,
  textInput,
  updateModelConfig,
  updatePermission,
  updateProjectMemory,
  updateThemeConfig,
  writeHandoff,
} from "@bennira/core";
import { repl } from "./repl.mjs";

const [, , command = "repl", ...args] = process.argv;

// 根据 config + 当前终端能力构建主题渲染器。--no-color / NO_COLOR 会自动降级。
function loadTheme(root, args = []) {
  const config = readConfig(root);
  const forcePlain = args.includes("--no-color");
  return createTheme(config, forcePlain ? { enabled: false } : {});
}

try {
  await run(command, args);
} catch (error) {
  if (process.env.BENNIRA_DEBUG) {
    console.error(error instanceof Error ? error.stack : String(error));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

async function run(name, args) {
  switch (name) {
    case "setup":
      return setup(args);
    case "repl":
    case "chat":
    case "shell":
      return repl(args);
    case "inspect":
      return inspect(args);
    case "init":
      return init(args);
    case "status":
      return status(args);
    case "plan":
      return plan(args);
    case "log":
      return log(args);
    case "handoff":
      return handoff(args);
    case "theme":
      return theme(args);
    case "key":
      return keyCommand(args);
    case "help":
    case "--help":
    case "-h":
      return help();
    default:
      console.error(`未知命令：${name}`);
      help();
      process.exitCode = 1;
  }
}

// ============================================================================
// setup —— 首次运行引导向导
// ============================================================================
// 抄 Claude Code / Codex 的 onboarding：安装后先做基础设置，而不是在对话里要 key。
// 收集：版本线主题、模型 baseURL/model/key、是否允许联网。
// key 写 .bennira/secrets.json（gitignore + chmod 600），其余进 config.json。
async function setup(args) {
  const root = process.cwd();
  const result = inspectWorkspace(root);
  // 确保 .bennira 记忆存在，setup 才有地方落配置。
  ensureProjectMemory(result.root, result);
  const t = loadTheme(result.root, args);
  const g = t.glyphs;

  console.log(t.title("Bennira 首次设置向导"));
  console.log(t.muted("  谨慎、只读、不留痕。凭证只存本地、绝不入库。"));

  // 是否为真人终端：决定用"方向键菜单"还是"一次性读 stdin"。
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (interactive) {
    console.log(t.muted(`  ${g.arrow} 用 ↑/↓ 或 j/k 选择，回车确认；也可直接按数字键。`));
  }
  console.log("");

  // 染色配件：菜单指针 / 高亮项 / 普通项 / 灰字 / 标题，全部走主题 token。
  // item（未选中项）用 value 色渲染，避免白底一片灰、黑底看不见。
  const menuPaint = {
    pointer: (s) => t.accent(s),
    active: (s) => t.accent(s),
    item: (s) => t.value(s),
    dim: (s) => t.muted(s),
    heading: (s) => t.value(s),
  };
  const textPaint = { label: (s) => t.value(s), dim: (s) => t.muted(s) };

  // 非 TTY（管道 / 脚本 / 无法交互的集成终端）：一次性读完 stdin，按行喂默认答案。
  // 这样 `printf '...' | bennira setup` 仍可驱动，且绝不挂起。
  let pipedQueue = null;
  let pipedIdx = 0;
  if (!interactive) {
    const piped = await readAllStdin();
    pipedQueue = piped.split(/\r?\n/);
  }
  const nextPiped = (def) => {
    const raw = pipedQueue && pipedIdx < pipedQueue.length ? pipedQueue[pipedIdx++] : "";
    return (raw || "").trim() || def;
  };

  // 统一入口：有限选项走方向键菜单 / 非 TTY 匹配管道行；自由文本走输入框 / 非 TTY 取管道行。
  const choose = async (question, choices, def) => {
    if (interactive) {
      return selectMenu(question, choices, { def, paint: menuPaint });
    }
    // 非 TTY：把管道行归一化到某个 value（支持前缀匹配，如 "g" → "global"）。
    const ans = nextPiped(def);
    const hit = choices.find(
      (c) => c.value === ans || c.value.startsWith(ans) || (ans && c.value.startsWith(ans[0]))
    );
    const value = hit ? hit.value : def;
    console.log(`${t.accent(g.arrow)} ${t.value(question)}  ${t.muted(value)}`);
    return value;
  };
  const askText = async (question, def = "", opts = {}) => {
    if (interactive) {
      return textInput(question, { def, paint: textPaint, ...opts });
    }
    const value = nextPiped(def);
    const hint = def ? t.muted(`（默认 ${def}）`) : "";
    console.log(`${t.accent(g.arrow)} ${t.value(question)} ${hint}  ${t.muted(value || "(空)")}`);
    return value;
  };

  // 0) 配置作用域：全局（一次配好所有项目）还是仅当前项目
  console.log(t.heading("① 配置作用域"));
  const scopeVal = await choose(
    "配置写到哪一层？",
    [
      { value: "global", label: "global", hint: "写入 ~/.bennira，所有项目共享（推荐）" },
      { value: "project", label: "project", hint: "只写当前项目 .bennira，覆盖全局" },
    ],
    "global"
  );
  const scope = scopeVal === "project" ? SCOPES.PROJECT : SCOPES.GLOBAL;
  const opt = { scope };
  console.log("");

  // 1) 模型接入 —— 先选服务商（自动带出 baseURL），填 key，再拉模型列表选一个
  //    配色主题不在此处问：那是纯审美偏好，不该占用 onboarding。
  //    默认盗贼紫，想换事后用 `bennira theme use <id>`。
  console.log(t.heading("② 模型接入"));
  console.log(t.muted("  选一家服务商即可，网址会自动带出；模型可从内置目录直接选，填了 key 还会用真实列表校准。"));

  // 已有配置时，默认高亮匹配的预设；匹配不到就落到 custom。
  const existingBaseURL = readConfig(root).model?.baseURL || "";
  const matchedPreset = PROVIDER_PRESETS.find(
    (p) => p.baseURL && existingBaseURL && p.baseURL === existingBaseURL
  );
  const providerId = await choose(
    "选择模型服务商",
    PROVIDER_PRESETS.map((p) => ({
      value: p.id,
      label: p.label,
      hint: p.model ? `${p.model} · ${p.hint}` : p.hint,
    })),
    matchedPreset ? matchedPreset.id : (existingBaseURL ? "custom" : "deepseek")
  );
  const preset = findProviderPreset(providerId) || findProviderPreset("custom");

  // 预设带出默认值：选了具体服务商，baseURL 默认就填好，用户回车即用、想改也能改；
  // 选 custom 则默认值回到"空"，走原来的手填。
  const baseURLDefault = preset.baseURL || existingBaseURL || "";
  const modelFallback = preset.model || readConfig(root).model?.model || "gpt-4o-mini";

  if (preset.id === "custom") {
    console.log(t.muted("  例：https://api.openai.com/v1 或本地 http://localhost:11434/v1"));
  } else {
    console.log(t.muted(`  已选 ${preset.label}：直接回车即用下面带出的默认网址，想改也可以。`));
  }
  const baseURL = await askText("模型 baseURL", baseURLDefault);

  // —— key 现在是「可选增强」，不再是选模型的前提 ——
  // 模型已能从内置目录直接选（策略一）；填了 key 只是额外用真实列表校准（策略二），
  // 并把这把 key 存进多 key 库（带 provider 标签，后续可 bennira key 管理/切换）。
  console.log(t.muted("  API key 只写入 secrets.json（已 gitignore），不进 config、不上传。可留空，稍后用 bennira key add 再加。"));
  const apiKey = await askText("API key（留空则稍后用环境变量 BENNIRA_API_KEY 或 bennira key add）", "");
  if (apiKey) {
    const path = saveModelApiKey(root, apiKey, { ...opt, label: preset.label, provider: preset.id });
    console.log(`  ${t.success(g.found)} ${t.muted(`已安全写入 ${path}`)}`);
    if (scope === SCOPES.PROJECT) {
      const { changed } = ensureSecretsIgnored(root);
      if (changed) {
        console.log(`  ${t.success(g.found)} ${t.muted("已自动在 .gitignore 中排除 secrets.json，凭证不会入库。")}`);
      } else {
        console.log(`  ${t.muted(`${g.bullet} .gitignore 已排除 secrets.json，凭证安全。`)}`);
      }
    }
  }

  // 拉模型列表让用户选。内置目录不依赖 key 立即可选；填了 key 再叠加实时拉取。
  const model = await pickModel({
    providerId: preset.id,
    baseURL,
    apiKey,
    fallback: modelFallback,
    interactive,
    t,
    g,
    menuPaint,
    askText,
  });

  updateModelConfig(root, { baseURL, model }, opt);
  console.log("");

  // 2) 网络权限门
  console.log(t.heading("③ 网络权限"));
  console.log(t.muted("  盗贼默认谨慎（deny）。调云端模型需要联网。"));
  const netVal = await choose(
    "允许联网调用模型？",
    [
      { value: "deny", label: "deny", hint: "保持谨慎，暂不联网（默认）" },
      { value: "allow", label: "allow", hint: "开启联网，init/plan/会话可调模型" },
    ],
    "deny"
  );
  const networkAllowed = netVal === "allow";
  updatePermission(root, "network", networkAllowed ? "allow" : "deny", opt);
  console.log("");

  // 汇总就绪状态
  const config = readConfig(root);
  const rd = modelReadiness(root, config);
  appendEvent(root, {
    type: "setup",
    summary: "完成首次设置向导",
    files: [".bennira/config.json", ".bennira/secrets.json"],
    result: "success",
    tool: "bennira setup",
    risk: "low",
  });

  const nt = loadTheme(root, args);
  console.log(nt.title("设置完成"));
  console.log(nt.kv("配色主题", `${nt.job}（${nt.character ?? "自定义"}）`));
  console.log(nt.kv("模型 baseURL", config.model?.baseURL || "(未填)"));
  console.log(nt.kv("模型名称", config.model?.model || "(未填)"));
  console.log(nt.kv("联网权限", rd.networkAllowed ? "allow" : "deny"));
  console.log(nt.kv("凭证来源", rd.keySource === "none" ? "未配置" : rd.keySource));
  console.log("");
  if (rd.ready) {
    console.log(`${nt.success(nt.glyphs.found)} ${nt.value("模型已就绪。运行 ")}${nt.accent('bennira init')}${nt.value(" 让 Bennira 读懂项目并生成 AGENTS.md。")}`);
  } else {
    console.log(`${nt.warning(nt.glyphs.warn || "!")} ${nt.muted("模型尚未完全就绪。补齐 baseURL / 模型名 / key 并允许联网后，init/plan 才能运行。")}`);
  }
}

// setup 里选模型：内置目录立即可选（策略一），填了 key 再叠加实时拉取（策略二）。
// -----------------------------------------------------------------------------
// 这是对齐 openclaw「初始化就能选」体验的落点。分层兜底，永远给得出选项：
//   1. 先拿服务商的「内置模型目录」（builtinModels）—— 不依赖 key、不联网，立刻有菜单。
//   2. 若已填 key 且可交互 → 调 listModels 实时拉取，用 mergeModelLists 叠加校准
//      （内置在前、实时补后、去重）。拉取失败静默保留内置目录，不打断。
//   3. 合并后有列表 + 交互终端 → selectMenu 选（默认高亮 fallback 若在列）。
//   4. 合并后仍为空（custom 无目录、又没拉到）→ 才退回 askText 手填。
async function pickModel({ providerId, baseURL, apiKey, fallback, interactive, t, g, menuPaint, askText }) {
  // 策略一：内置目录——选完服务商这一刻就能给（零 key、零网络）。
  let models = builtinModels(providerId);

  // 策略二：有 key 且能交互时，实时拉取叠加校准。失败不影响内置目录。
  if (apiKey && interactive && baseURL) {
    console.log(t.muted(`  ${g.arrow} 已填 key，正在用真实模型列表校准…`));
    const res = await listModels(baseURL, apiKey, { timeoutMs: 8000 });
    if (res.ok) {
      const before = models.length;
      models = mergeModelLists(models, res.models);
      console.log(`  ${t.success(g.found)} ${t.muted(`实时拉到 ${res.models.length} 个，合并后共 ${models.length} 个可选。`)}`);
      void before;
    } else if (models.length > 0) {
      console.log(`  ${t.muted(`${g.bullet} 实时拉取未成功（${res.error}），先用内置目录，可稍后 bennira setup 重试。`)}`);
    } else {
      // 内置目录也为空（custom）+ 拉取失败 → 讲清原因，落到手填。
      console.log(`  ${t.warning(g.warn || "!")} ${t.muted(`无法拉取模型列表（${res.error}），改为手动输入。`)}`);
    }
  }

  // 非交互（管道/脚本）或无任何可选项 → 手填/默认。
  if (!interactive || models.length === 0) {
    return askText("模型名称", fallback);
  }

  const items = models.map((id) => ({ value: id, label: id }));
  const def = models.includes(fallback) ? fallback : models[0];
  console.log(t.muted(`  用 ↑/↓ 选择模型（共 ${models.length} 个，回车确认）。`));
  return selectMenu("选择模型", items, { def, paint: menuPaint });
}

function inspect(args) {
  const rootArg = firstPathArg(args) ?? process.cwd();
  const result = inspectWorkspace(rootArg);
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const t = loadTheme(result.root, args);
  console.log(formatInspectResult(result, t));
}

// ============================================================================
// init —— 观察 → 组 context → 调模型 → 生成 AGENTS.md（无凭证/断网则降级）
// ============================================================================
async function init(args) {
  const rootArg = firstPathArg(args) ?? process.cwd();
  const result = inspectWorkspace(rootArg);
  const root = result.root;
  // 始终先建/更新 .bennira JSON 记忆（这是本地状态，不依赖模型）。
  ensureProjectMemory(root, result);
  const config = readConfig(root);
  const t = loadTheme(root, args);
  const g = t.glyphs;

  // 强制配置门：init 的价值全在"读懂项目"，没模型就没有意义。
  // 不降级、不写假 AGENTS.md，直接拦下并指向 setup。
  if (!requireModelReady(t, root, config)) {
    process.exitCode = 1;
    return;
  }

  const agentsPath = join(root, "AGENTS.md");
  const agentsExists = existsSync(agentsPath);

  console.log(t.muted(`${g.arrow} 正在读懂项目并${agentsExists ? "审查改进" : "生成"} AGENTS.md…`));
  const provider = createProvider(root, config);
  const existingAgentsMd = agentsExists ? readFileSync(agentsPath, "utf8") : undefined;
  const messages = buildInitMessages(result, { existingAgentsMd });

  // 流式 + spinner：思考期转圈，首字到达即停圈并逐字冒出。
  const spin = createSpinner("正在读懂项目…", { enabled: t.enabled, paint: (s) => t.accent(s) });
  spin.start();
  let started = false;
  const content = await provider.generateStream(messages, (delta) => {
    if (!started) {
      spin.stop();
      console.log(t.muted(`${g.arrow} 生成中：`));
      started = true;
    }
    process.stdout.write(t.enabled ? t.value(delta) : delta);
  });
  if (started) process.stdout.write("\n");
  else spin.stop();
  writeFileSync(agentsPath, `${content.trimEnd()}\n`, "utf8");

  const event = appendEvent(root, {
    type: "init",
    summary: agentsExists ? "审查并改进 AGENTS.md" : "生成 AGENTS.md 项目记忆",
    files: ["AGENTS.md", ".bennira/config.json", ".bennira/state.json"],
    result: "success",
    next: ['运行 `bennira plan "…"` 生成下一步计划。', "运行 `bennira handoff` 刷新交接文档。"],
    tool: "bennira init",
    risk: "medium",
  });
  updateProjectMemory(root, { lastAction: event });

  console.log(t.title(`Bennira 已${agentsExists ? "更新" : "生成"} AGENTS.md`));
  console.log(t.kv("项目根目录", root));
  console.log(t.kv("文档路径", "AGENTS.md"));
  console.log(t.kv("模式", agentsExists ? "审查改进（保留原有约定）" : "首次生成"));
  console.log("");
  console.log(t.muted("  这是起点不是终点——请审阅并补充 AI 猜不到的团队约定。"));
}

// 强制配置门：模型未就绪时打印精准原因 + 指向 setup，返回 false。
// 与旧的 printModelHint 区别在于：这是"拦截"，不是"提示后继续降级"。
function requireModelReady(t, root, config) {
  const rd = modelReadiness(root, config);
  if (rd.ready) return true;
  const g = t.glyphs;
  const reasons = [];
  if (!rd.networkAllowed) reasons.push("联网权限为 deny");
  if (!rd.hasBaseURL) reasons.push("未配置 baseURL");
  if (!rd.hasModel) reasons.push("未配置模型名");
  if (!rd.hasKey) reasons.push("未配置 API key");
  console.log(`${t.danger(g.missing)} ${t.danger("模型未就绪，无法执行。")}`);
  console.log(`  ${t.muted("缺少：")}${t.warning(reasons.join("、"))}`);
  console.log("");
  console.log(`  ${t.accent(g.arrow)} ${t.value("请先运行 ")}${t.accent("bennira setup")}${t.value(" 完成模型接入。")}`);
  return false;
}

function status(args) {
  const rootArg = firstPathArg(args) ?? process.cwd();
  const result = inspectWorkspace(rootArg);
  const memory = readProjectMemory(result.root);
  const eventLog = readEventLog(result.root, { limit: 10 });
  if (args.includes("--json")) {
    console.log(JSON.stringify({ memory, events: eventLog.events, warnings: eventLog.warnings }, null, 2));
    return;
  }
  const t = loadTheme(result.root, args);
  console.log(formatStatus(memory, eventLog.events, t));
  // 附带模型就绪状态，让用户一眼看到"大脑"接没接上。
  const config = readConfig(result.root);
  const rd = modelReadiness(result.root, config);
  console.log("");
  console.log(t.heading("模型"));
  const dot = rd.ready ? t.success(t.glyphs.found) : t.warning(t.glyphs.warn || "!");
  console.log(`  ${dot} ${t.value(rd.ready ? "已就绪" : "未就绪")}  ${t.muted(`${config.model?.model || "(无模型)"} · 网络 ${rd.networkAllowed ? "allow" : "deny"} · key ${rd.keySource}`)}`);
  if (eventLog.warnings.length > 0) {
    console.log("");
    console.log(t.warning(`日志中有 ${eventLog.warnings.length} 条坏行，已跳过。`));
  }
}

// ============================================================================
// plan —— 调模型生成真计划（无凭证/断网则降级回模板）
// ============================================================================
async function plan(args) {
  const noWrite = args.includes("--no-write");
  const input = args
    .filter((arg) => arg !== "--no-write" && arg !== "--no-color")
    .join(" ")
    .trim();
  if (!input) {
    console.error("请提供计划输入，例如：bennira plan \"我想继续推进这个项目\"");
    process.exitCode = 1;
    return;
  }
  const result = inspectWorkspace(process.cwd());
  const root = result.root;
  const config = readConfig(root);
  const t = loadTheme(root, args);
  const g = t.glyphs;

  // 强制配置门：plan 的价值在"结合项目状态真生成计划"，没模型就是写死模板，没意义。
  if (!requireModelReady(t, root, config)) {
    process.exitCode = 1;
    return;
  }

  console.log(t.muted(`${g.arrow} 正在结合项目状态生成计划…`));
  const provider = createProvider(root, config);
  const messages = buildPlanMessages(result, input);
  const spin = createSpinner("正在思考…", { enabled: t.enabled, paint: (s) => t.accent(s) });
  spin.start();
  let raw;
  try {
    // 流式收（首字到达即把 spinner 文案切成"正在生成…"），但 plan 是结构化 JSON，
    // 收全后再解析展示，不逐字吐 JSON。
    raw = await provider.generateStream(messages, () => spin.setText("正在生成计划…"));
  } finally {
    spin.stop();
  }
  const parsed = parsePlanResponse(raw);
  const output = {
    createdAt: new Date().toISOString(),
    input,
    projectRoot: root,
    summary: parsed.summary,
    observed: {
      isGitRepo: result.isGitRepo,
      packageKind: result.packageKind,
      docsFound: result.docs.filter((d) => d.exists).map((d) => d.path),
      docsMissing: result.docs.filter((d) => !d.exists).map((d) => d.path),
    },
    nextSteps: parsed.notes ? [...parsed.nextSteps, `注：${parsed.notes}`] : parsed.nextSteps,
  };

  if (!noWrite) {
    const dir = join(root, ".bennira");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "last-plan.md"), `${formatPlanMarkdown(output)}\n`, "utf8");
    const event = appendEvent(root, {
      type: "plan",
      summary: "生成计划（模型）",
      input,
      files: [".bennira/last-plan.md"],
      result: "success",
      next: output.nextSteps,
      tool: "bennira plan",
      risk: "medium",
    });
    updateProjectMemory(root, {
      lastAction: event,
      lastPlanPath: ".bennira/last-plan.md",
      nextSteps: output.nextSteps,
    });
  }

  console.log(formatPlan(output, t));
  console.log("");
  console.log(t.muted(`${g.found || "*"} 由模型生成。`));
  if (noWrite) {
    console.log(t.muted("预览模式：未写入文件，未追加事件日志。"));
  }
}

function log(args) {
  const rootArg = firstPathArg(args) ?? process.cwd();
  const result = inspectWorkspace(rootArg);
  const limit = numberArg(args, "--limit") ?? 20;
  const eventLog = readEventLog(result.root, { limit });
  const t = loadTheme(result.root, args);
  console.log(formatEvents(eventLog.events, eventLog.warnings, t));
}

function handoff(args) {
  const rootArg = firstPathArg(args) ?? process.cwd();
  const result = inspectWorkspace(rootArg);
  const output = writeHandoff(result.root, result);
  const event = appendEvent(result.root, {
    type: "handoff",
    summary: "刷新跨工具交接文档",
    files: [output.path],
    result: "success",
    next: ["新对话或其他工具先读 README.md、AGENTS.md、docs/HANDOFF.md。"],
    tool: "bennira handoff",
    risk: "medium",
  });
  updateProjectMemory(result.root, {
    lastAction: event,
    handoffPath: output.path,
  });
  const t = loadTheme(result.root, args);
  console.log(`${t.success(t.glyphs.found)} ${t.value(`已刷新 ${output.path}`)}`);
  if (output.warnings.length > 0) {
    console.log(t.warning(`事件日志中有 ${output.warnings.length} 条坏行，已跳过。`));
  }
}

// theme 子命令：list / show / use <id> / set <token> <#hex> / reset -------------
function theme(args) {
  const root = process.cwd();
  const [sub = "list", ...rest] = args.filter((a) => a !== "--no-color");
  const t = loadTheme(root, args);

  switch (sub) {
    case "list": {
      console.log(formatThemeList(readConfig(root), t));
      return;
    }
    case "show": {
      console.log(formatThemeShow(readConfig(root), t));
      return;
    }
    case "use": {
      const id = rest[0];
      if (!id) {
        console.error("请提供主题 id，例如：bennira theme use warrior");
        process.exitCode = 1;
        return;
      }
      const config = readConfig(root);
      const isCustom = Boolean(config.theme?.custom && config.theme.custom[id]);
      const known = Boolean(JOB_THEMES[id] || isCustom);
      if (!known) {
        console.error(`未知主题：${id}。运行 bennira theme list 查看可用主题。`);
        process.exitCode = 1;
        return;
      }
      // 一代版本线只开放盗贼；其余职业配色虽已写好但锁定，切换时拦下。
      // 自定义主题不受锁定约束（用户自己造的）。
      if (!isCustom && !isThemeUnlocked(id)) {
        const nt = loadTheme(root, args);
        console.error(
          `${nt.warning(nt.glyphs.warn || "!")} ${nt.value(`「${id}」职业尚未在本代开放。`)}`
        );
        console.error(`  ${nt.muted("一代仅开放盗贼（thief）。其余职业为后续版本预留。")}`);
        process.exitCode = 1;
        return;
      }
      updateThemeConfig(root, { active: id });
      appendEvent(root, {
        type: "theme",
        summary: `切换配色主题为 ${id}`,
        files: [".bennira/config.json"],
        result: "success",
        tool: "bennira theme use",
        risk: "low",
      });
      const nt = loadTheme(root, args);
      console.log(`${nt.success(nt.glyphs.found)} ${nt.value("已切换主题")} ${nt.accent(id)}`);
      console.log(formatThemeShow(readConfig(root), nt));
      return;
    }
    case "set": {
      const [token, color] = rest;
      const validTokens = [
        "brand",
        "accent",
        "heading",
        "label",
        "value",
        "muted",
        "success",
        "warning",
        "danger",
        "info",
      ];
      if (!token || !color) {
        console.error("用法：bennira theme set <token> <#hex>，例如：bennira theme set accent #ff66cc");
        process.exitCode = 1;
        return;
      }
      if (!validTokens.includes(token)) {
        console.error(`未知 token：${token}。可用：${validTokens.join("、")}`);
        process.exitCode = 1;
        return;
      }
      if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) {
        console.error(`颜色格式无效：${color}，请用 #rrggbb 或 #rgb。`);
        process.exitCode = 1;
        return;
      }
      const normalized = color.startsWith("#") ? color : `#${color}`;
      updateThemeConfig(root, { override: { token, color: normalized } });
      appendEvent(root, {
        type: "theme",
        summary: `自定义 token ${token} = ${normalized}`,
        files: [".bennira/config.json"],
        result: "success",
        tool: "bennira theme set",
        risk: "low",
      });
      const nt = loadTheme(root, args);
      console.log(`${nt.success(nt.glyphs.found)} ${nt.value("已覆盖")} ${nt.label(token)} ${nt.muted("→")} ${nt[token] ? nt[token](normalized) : normalized}`);
      return;
    }
    case "reset": {
      updateThemeConfig(root, { resetOverrides: true });
      const nt = loadTheme(root, args);
      console.log(`${nt.success(nt.glyphs.found)} ${nt.value("已清除所有自定义覆盖，回到预设配色。")}`);
      return;
    }
    default: {
      console.error(`未知 theme 子命令：${sub}`);
      const nt = loadTheme(root, args);
      console.log(nt.muted("可用：list | show | use <id> | set <token> <#hex> | reset"));
      process.exitCode = 1;
    }
  }
}

// key 子命令：list / add / use <id> / remove <id> —— 多 key 管理 -----------------
// -----------------------------------------------------------------------------
// 支持一人多把 key（不同服务商 / 工作号 / 个人号），随时切换激活项。
// 凭证不留痕原则不变：只写 .bennira/secrets.json（gitignore + chmod 600），脱敏展示。
// --scope project|global 决定操作哪一层（默认 global，与 setup 默认一致）。
async function keyCommand(args) {
  const root = process.cwd();
  const clean = args.filter((a) => a !== "--no-color");
  // 解析 --scope
  let scope = SCOPES.GLOBAL;
  const scopeIdx = clean.indexOf("--scope");
  if (scopeIdx >= 0 && clean[scopeIdx + 1]) {
    scope = clean[scopeIdx + 1] === "project" ? SCOPES.PROJECT : SCOPES.GLOBAL;
    clean.splice(scopeIdx, 2);
  }
  const opt = { scope };
  const [sub = "list", ...rest] = clean;
  const t = loadTheme(root, args);
  const g = t.glyphs;
  const scopeName = scope === SCOPES.PROJECT ? "项目层" : "全局层";

  switch (sub) {
    case "list": {
      const { keys, activeKeyId } = listModelKeys(root, opt);
      console.log(t.title(`模型 API Key（${scopeName}）`));
      if (keys.length === 0) {
        console.log(t.muted("  （空）还没有配置任何 key。用 bennira key add 添加，或跑 bennira setup。"));
        return;
      }
      keys.forEach((k) => {
        const marker = k.active ? t.success(g.found) : t.muted(" ");
        const id = k.active ? t.accent(padDisplay(k.id, 10)) : t.value(padDisplay(k.id, 10));
        const prov = k.provider ? t.muted(`[${k.provider}]`) : t.muted("[通用]");
        const label = t.label(k.label || "");
        console.log(`  ${marker} ${id} ${prov} ${label}  ${t.muted(k.masked)}`);
      });
      console.log("");
      console.log(t.muted(`  激活中：${activeKeyId || "(无)"}　切换：bennira key use <id>`));
      return;
    }
    case "add": {
      // 交互填写；也支持参数：bennira key add <key> [--label x] [--provider y]
      const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const textPaint = { label: (s) => t.value(s), dim: (s) => t.muted(s) };
      const menuPaint = {
        pointer: (s) => t.accent(s), active: (s) => t.accent(s),
        item: (s) => t.value(s), dim: (s) => t.muted(s), heading: (s) => t.value(s),
      };

      // 参数形态优先：第一个非 -- 参数当作 key。
      let apiKey = rest.find((a) => !a.startsWith("--")) || "";
      const argLabel = optValue(rest, "--label");
      const argProvider = optValue(rest, "--provider");

      let label = argLabel || "";
      let provider = argProvider || "";

      if (interactive && !apiKey) {
        // 先选归属服务商（可选，便于日后识别），再填 key 与备注。
        provider = await selectMenu(
          "这把 key 属于哪家服务商？",
          [
            ...PROVIDER_PRESETS.filter((p) => p.id !== "custom").map((p) => ({ value: p.id, label: p.label })),
            { value: "", label: "通用 / 其它" },
          ],
          { def: provider || "deepseek", paint: menuPaint }
        );
        apiKey = await textInput("API key", { def: "", paint: textPaint });
        label = await textInput("备注名（便于区分，可留空）", { def: label || (provider ? findProviderPreset(provider)?.label : "") || "", paint: textPaint });
      }

      if (!apiKey) {
        console.error(`${t.warning(g.warn || "!")} ${t.value("未提供 key。用法：bennira key add <key> [--label 备注] [--provider deepseek] [--scope project]")}`);
        process.exitCode = 1;
        return;
      }

      const { id, path } = addModelKey(root, { apiKey, label, provider: provider || null }, opt);
      if (scope === SCOPES.PROJECT) ensureSecretsIgnored(root);
      appendEvent(root, {
        type: "key", summary: `新增模型 key（${scopeName}）：${label || id}`,
        files: [".bennira/secrets.json"], result: "success", tool: "bennira key add", risk: "low",
      });
      console.log(`${t.success(g.found)} ${t.value("已新增并激活 key")} ${t.accent(id)} ${t.muted(`→ ${maskKey(apiKey)}（${path}）`)}`);
      return;
    }
    case "use": {
      const id = rest.find((a) => !a.startsWith("--"));
      if (!id) {
        console.error("请提供 key id，例如：bennira key use key-2（用 bennira key list 查看 id）");
        process.exitCode = 1;
        return;
      }
      try {
        useModelKey(root, id, opt);
        console.log(`${t.success(g.found)} ${t.value("已切换激活 key 为")} ${t.accent(id)}`);
      } catch (e) {
        console.error(`${t.warning(g.warn || "!")} ${t.value(e.message)}　用 bennira key list 查看可用 id。`);
        process.exitCode = 1;
      }
      return;
    }
    case "remove":
    case "rm": {
      const id = rest.find((a) => !a.startsWith("--"));
      if (!id) {
        console.error("请提供 key id，例如：bennira key remove key-2");
        process.exitCode = 1;
        return;
      }
      try {
        const { activeKeyId } = removeModelKey(root, id, opt);
        appendEvent(root, {
          type: "key", summary: `删除模型 key（${scopeName}）：${id}`,
          files: [".bennira/secrets.json"], result: "success", tool: "bennira key remove", risk: "low",
        });
        console.log(`${t.success(g.found)} ${t.value("已删除 key")} ${t.accent(id)}${activeKeyId ? t.muted(`，当前激活：${activeKeyId}`) : t.muted("，已无可用 key")}`);
      } catch (e) {
        console.error(`${t.warning(g.warn || "!")} ${t.value(e.message)}`);
        process.exitCode = 1;
      }
      return;
    }
    default: {
      console.error(`未知 key 子命令：${sub}`);
      console.log(t.muted("可用：list | add [<key> --label 备注 --provider deepseek] | use <id> | remove <id>　（--scope project|global）"));
      process.exitCode = 1;
    }
  }
}

// 从参数数组里取 --flag 后的值（无则空串）。
function optValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
}

function firstPathArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return null;
}

function numberArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// 一次性读完 stdin（用于非 TTY 的管道 / 脚本驱动 setup）。
function readAllStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function help() {
  const t = loadTheme(process.cwd(), process.argv.slice(2));
  const g = t.glyphs;
  const line = (cmd, desc) => `  ${t.accent(padDisplay(cmd, 40))}${t.muted(desc)}`;
  console.log(
    [
      t.title("Bennira 一代 · 小偷"),
      "",
      t.heading("上手"),
      line("bennira setup", "首次设置：主题 / 模型 / 网络权限"),
      line("bennira", "进入交互会话（默认，连续对话 + 动手办事）"),
      "",
      t.heading("用法"),
      line("bennira repl", "交互式会话：流式对话，能读写文件 / 跑命令"),
      line("bennira inspect [path] [--json]", "观察当前项目"),
      line("bennira init [path]", "读懂项目并生成 AGENTS.md（需先接模型）"),
      line("bennira status [path] [--json]", "查看 Bennira 与模型状态"),
      line('bennira plan [--no-write] "中文想法"', "结合项目状态生成下一步计划（需先接模型）"),
      line("bennira log [path] [--limit 20]", "查看最近事件"),
      line("bennira handoff [path]", "刷新 docs/HANDOFF.md"),
      line("bennira theme [list|show|use|set|reset]", "查看 / 切换 / 自定义配色"),
      line("bennira key [list|add|use|remove]", "管理多把模型 API key（切换 / 增删）"),
      "",
      t.heading("配色"),
      `  ${t.muted(g.arrow)} ${t.value("一代默认盗贼紫（缇利翁）。八方旅人职业预设可一键切换。")}`,
      `  ${t.muted(g.arrow)} ${t.value("追加 --no-color 或设置 NO_COLOR 可强制纯文本输出。")}`,
      "",
      t.heading("能力"),
      `  ${t.muted(g.bullet)} ${t.value("交互会话中可读文件、改代码、跑命令——危险动作先请你确认。")}`,
      `  ${t.muted(g.bullet)} ${t.value("流式输出 + 思考动画，连续对话累积上下文。")}`,
      `  ${t.muted(g.bullet)} ${t.value("凭证只存本地 .bennira/secrets.json，绝不入库。")}`,
    ].join("\n")
  );
}
