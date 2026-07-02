#!/usr/bin/env node
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
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
  listThemes,
  modelReadiness,
  padDisplay,
  parsePlanResponse,
  readConfig,
  readEventLog,
  readProjectMemory,
  saveModelApiKey,
  SCOPES,
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
  console.log(t.muted("  谨慎、只读、不留痕。凭证只存本地、绝不入库。回车用默认值。"));
  console.log("");

  // 交互 / 非交互双模：
  // - TTY（真人终端）：用 readline 逐问。
  // - 非 TTY（管道 / 脚本 / 自动化）：一次性读完 stdin，按行依次作为答案。
  //   这样 `printf '...' | bennira setup` 也能驱动，且不会出现 readline 挂起。
  let ask;
  let rl = null;

  if (process.stdin.isTTY) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    ask = (q, def = "") =>
      new Promise((resolve) => {
        const hint = def ? t.muted(`（默认 ${def}）`) : "";
        rl.question(`${t.accent(g.arrow)} ${t.value(q)} ${hint}\n  `, (answer) => {
          resolve(answer.trim() || def);
        });
      });
  } else {
    const piped = await readAllStdin();
    const queue = piped.split(/\r?\n/);
    let idx = 0;
    ask = async (q, def = "") => {
      const hint = def ? t.muted(`（默认 ${def}）`) : "";
      const raw = idx < queue.length ? queue[idx++] : "";
      const value = (raw || "").trim() || def;
      console.log(`${t.accent(g.arrow)} ${t.value(q)} ${hint}  ${t.muted(value || "(空)")}`);
      return value;
    };
  }

  try {
    // 0) 配置作用域：全局（一次配好所有项目）还是仅当前项目
    console.log(t.heading("① 配置作用域"));
    console.log(t.muted("  global：写入 ~/.bennira，所有项目共享（推荐，配一次到处用）"));
    console.log(t.muted("  project：只写当前项目 .bennira，覆盖全局设置"));
    const scopeAns = await ask("配置写到哪一层？(global/project)", "global");
    const scope = /^p(roject)?$/i.test(scopeAns) ? SCOPES.PROJECT : SCOPES.GLOBAL;
    const opt = { scope };
    console.log("");

    // 1) 主题 / 版本线
    console.log(t.heading("② 配色主题"));
    const themeItems = listThemes(readConfig(root))
      .filter((i) => i.kind === "preset")
      .map((i) => i.id);
    console.log(t.muted(`  可选：${themeItems.join(" / ")}`));
    const themeId = await ask("选择职业配色", readConfig(root).theme?.active || "thief");
    if (JOB_THEMES[themeId]) {
      updateThemeConfig(root, { active: themeId }, opt);
    }
    console.log("");

    // 2) 模型接入
    console.log(t.heading("③ 模型接入（OpenAI 兼容）"));
    console.log(t.muted("  例：https://api.openai.com/v1 或本地 http://localhost:11434/v1"));
    const baseURL = await ask("模型 baseURL", readConfig(root).model?.baseURL || "");
    const model = await ask("模型名称", readConfig(root).model?.model || "gpt-4o-mini");
    updateModelConfig(root, { baseURL, model }, opt);

    console.log(t.muted("  API key 只写入 secrets.json（已 gitignore），不进 config、不上传。"));
    const apiKey = await ask("API key（留空则稍后用环境变量 BENNIRA_API_KEY）", "");
    if (apiKey) {
      const path = saveModelApiKey(root, apiKey, opt);
      console.log(`  ${t.success(g.found)} ${t.muted(`已安全写入 ${path}`)}`);
      // 全局 secrets 在 ~，不受项目 .gitignore 约束；仅项目层需要保护。
      // 修复：不再只警告，而是自动把 secrets.json 写进项目 .gitignore（幂等）。
      if (scope === SCOPES.PROJECT) {
        const { changed } = ensureSecretsIgnored(root);
        if (changed) {
          console.log(`  ${t.success(g.found)} ${t.muted("已自动在 .gitignore 中排除 secrets.json，凭证不会入库。")}`);
        } else {
          console.log(`  ${t.muted(`${g.bullet} .gitignore 已排除 secrets.json，凭证安全。`)}`);
        }
      }
    }
    console.log("");

    // 3) 网络权限门
    console.log(t.heading("④ 网络权限"));
    console.log(t.muted("  盗贼默认谨慎（deny）。调云端模型需要联网——是否现在开启？"));
    const allow = await ask("允许联网调用模型？(y/N)", "N");
    const networkAllowed = /^y(es)?$/i.test(allow);
    updatePermission(root, "network", networkAllowed ? "allow" : "deny", opt);
    console.log("");
  } finally {
    if (rl) rl.close();
  }

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
      const known = Boolean(JOB_THEMES[id] || (config.theme?.custom && config.theme.custom[id]));
      if (!known) {
        console.error(`未知主题：${id}。运行 bennira theme list 查看可用主题。`);
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
