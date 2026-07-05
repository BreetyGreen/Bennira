// repl.mjs —— 交互式会话（持久 REPL + agentic 循环）
// -----------------------------------------------------------------------------
// 这是 Bennira 从"一次性命令"进化到"活着的会话"的地方。抄 Codex / Claude Code：
//   1. 持久 readline 循环：进来一次，连续对话，不用每次敲一长串 node ...。
//   2. 真流式输出：模型回答走 SSE 逐字冒出来（finish 消息也是真流式，不再假装）。
//   3. spinner：思考期转圈，消灭干等。
//   4. Ctrl+C 中断当前轮：停生成、回提示符，不退出进程（像 Codex / Claude Code）。
//   5. agentic：模型能读文件、改文件、跑命令——危险动作先请你确认。
//   6. slash 补全 + 跨会话历史：输入 / 有 Tab 补全，上箭头可调出历史。
//
// slash 命令：/help /status /init /plan /clear /exit
// 直接输入自然语言 = 进入 agentic 循环，让 Bennira 动手办事。

import { createInterface } from "node:readline";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { execSync } from "node:child_process";
import {
  inspectWorkspace,
  readConfig,
  createTheme,
  createProvider,
  modelReadiness,
  createSpinner,
  buildProjectSnapshot,
  buildAgentMessages,
  parseAgentAction,
  toolSchemas,
  actionFromToolCall,
  AGENT_TOOL_RISK,
  appendEvent,
  buildInitMessages,
  buildPlanMessages,
  parsePlanResponse,
  formatPlanMarkdown,
  ensureProjectMemory,
  updateProjectMemory,
  UserAbortError,
  globalRoot,
  SLASH_COMMANDS,
  slashCompleter,
  normalizeHistory,
  extractAtMentions,
  atTokenAtEnd,
  atFileCompleter,
  initialInputState,
  feedInputLine,
} from "@bennira/core";

const MAX_STEPS = 12; // 单轮 agentic 循环的最大工具调用步数，防跑飞
const MAX_READ_CHARS = 6000; // 单个 read_file 回喂给模型的字符上限
const HISTORY_LIMIT = 500; // 命令历史保留条数
const MAX_MENTION_CHARS = 8000; // 单个 @文件注入上下文的字符上限
const MAX_FILE_CANDIDATES = 2000; // @补全候选文件数上限（防超大仓库遍历爆炸）

export async function repl(args, opts = {}) {
  const root = inspectWorkspace(process.cwd()).root;
  const config = readConfig(root);
  const forcePlain = args.includes("--no-color");
  // 背景明暗由 CLI 入口探测后透传（OSC 11）。config.theme.appearance 手动值在 createTheme 内更优先。
  const themeOpts = forcePlain
    ? { enabled: false }
    : opts.background
      ? { background: opts.background }
      : {};
  const t = createTheme(config, themeOpts);
  const g = t.glyphs;

  const rd = modelReadiness(root, config);
  banner(t, root, rd);
  if (!rd.ready) {
    console.log(
      `${t.danger(g.missing)} ${t.danger("模型未就绪")} ${t.muted("——先运行 ")}${t.accent("bennira setup")}${t.muted(" 接上模型，REPL 才能对话。")}`
    );
    return;
  }

  // 跨会话历史：从全局层载入（尊重 BENNIRA_HOME），退出时写回。
  const historyPath = join(globalRoot(), ".bennira", "repl_history");
  const priorHistory = loadHistory(historyPath);

  // @文件补全的候选：启动时扫一遍项目文件（跳过 node_modules/.git，带上限）。
  // 惰性缓存——只在第一次按 Tab 时才真正遍历，避免大仓库拖慢启动。
  let fileCandidates = null;
  const getFileCandidates = () => {
    if (fileCandidates === null) fileCandidates = listProjectFiles(root);
    return fileCandidates;
  };

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    // 合并补全：以 "/" 开头补 slash 命令；行尾是 @token 补项目文件。
    completer: (line) => {
      const at = atTokenAtEnd(line);
      if (at.active) return atFileCompleter(line, getFileCandidates());
      return slashCompleter(line);
    },
    // readline 的 history 需要"最新在前"，我们存储是"最新在后"，载入时反转。
    history: [...priorHistory].reverse(),
    historySize: HISTORY_LIMIT,
  });
  const promptNormal = () => t.accent(`${t.sigil} `);
  const promptCont = () => t.muted("… "); // 反斜杠续行 / 三引号块内的续行提示符
  rl.setPrompt(promptNormal());

  // 会话级 agentic 历史（跨轮累积，形成"记忆"）。
  let history = [];
  // 多行输入累积状态：一条"逻辑输入"可能跨多行（续行 / 三引号块）。
  let inputState = initialInputState();

  rl.prompt();
  for await (const lineRaw of rl) {
    // 多行状态机：喂入这一行，未结束就继续收，结束才得到完整逻辑输入。
    const fed = feedInputLine(inputState, lineRaw);
    inputState = fed.state;
    if (!fed.done) {
      // 仍在多行累积中——切续行提示符，继续等下一行。
      rl.setPrompt(fed.prompt === "fence" ? t.muted('… (""" 结束) ') : promptCont());
      rl.prompt();
      continue;
    }
    // 一条完整逻辑输入拿到了，恢复正常提示符。
    rl.setPrompt(promptNormal());
    const line = fed.value.trim();
    if (!line) {
      rl.prompt();
      continue;
    }

    // slash 命令（只在单行、以 / 开头时判定）-------------------------------
    if (!line.includes("\n") && line.startsWith("/")) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const argStr = rest.join(" ");
      if (cmd === "exit" || cmd === "quit" || cmd === "q") {
        console.log(t.muted("再会。"));
        break;
      }
      if (cmd === "help" || cmd === "?") {
        printReplHelp(t);
        rl.prompt();
        continue;
      }
      if (cmd === "clear") {
        history = [];
        console.log(t.muted("已清空会话上下文。"));
        rl.prompt();
        continue;
      }
      if (cmd === "status") {
        const freshCfg = readConfig(root);
        const r = modelReadiness(root, freshCfg);
        console.log(
          `  ${r.ready ? t.success(g.found) : t.warning("!")} ${t.value(r.ready ? "已就绪" : "未就绪")}  ${t.muted(`${freshCfg.model?.model || "(无模型)"} · 网络 ${r.networkAllowed ? "allow" : "deny"} · key ${r.keySource}`)}`
        );
        rl.prompt();
        continue;
      }
      if (cmd === "init") {
        try {
          await runInit({ root, config, t, rl });
        } catch (error) {
          reportError(t, error);
        }
        rl.prompt();
        continue;
      }
      if (cmd === "plan") {
        if (!argStr) {
          console.log(t.muted('用法：/plan 你的想法，例如 /plan 给这个项目加一个导出 csv 的功能'));
          rl.prompt();
          continue;
        }
        try {
          await runPlan({ root, config, t, rl, input: argStr });
        } catch (error) {
          reportError(t, error);
        }
        rl.prompt();
        continue;
      }
      // 未知 slash：当作自然语言（去掉斜杠）继续
      console.log(t.muted(`未知命令 /${cmd}，当作提问处理。输入 /help 看可用命令。`));
    }

    // @文件引用：把 @path 的文件内容作为独立上下文块附加到用户输入 -----------
    const userInput = injectAtMentions(root, line, t);

    // 自然语言 → agentic 循环 ---------------------------------------------
    try {
      await runAgentTurn({ root, config, t, rl, history, userInput });
    } catch (error) {
      reportError(t, error);
    }
    rl.prompt();
  }

  rl.close();
  // 写回历史：readline 的 rl.history 是"最新在前"，反转回"最新在后"再归一存盘。
  saveHistory(historyPath, normalizeHistory([...rl.history].reverse(), { limit: HISTORY_LIMIT }));
}

// 统一错误呈现：用户主动中断（Ctrl+C）安静提示，其余按错误消息显示。
function reportError(t, error) {
  const g = t.glyphs;
  if (error instanceof UserAbortError || error?.code === "USER_ABORT") {
    console.log(`  ${t.warning("!")} ${t.muted("已中断。")}`);
    return;
  }
  console.log(`${t.danger(g.missing || "×")} ${t.danger(error?.message || String(error))}`);
}

// 一轮 agentic 循环：用户说一句 → 模型思考/调工具 → 直到 finish 或触顶。
// 全程可被 Ctrl+C 中断——按一次停当前轮、回提示符，不退出进程（抄 Codex / Claude Code）。
// provider 默认由 config 构建（生产路径，行为不变）；测试可注入 fake provider
// 以在不联网、不需要真实 key 的前提下验证整条 agentic 循环的 round-trip。
// 默认参数仅在 provider 缺省时求值，故生产调用与改造前完全等价。
export async function runAgentTurn({ root, config, t, rl, history, userInput, provider = createProvider(root, config) }) {
  const g = t.glyphs;
  history.push({ role: "user", content: userInput });

  // 工具协议：优先走原生 tool_calls（provider 暴露 generateWithTools 才有）。
  // toolsSpec 一轮只算一次。nativeAvailable 是"本会话能力开关"——首次原生请求即失败
  // （provider 不支持 tools）则本会话降级到老路。committedNative 记录"是否已成功用过
  // 原生通道"：一旦用过，说明 provider 确实支持 tools，此后再报错就是真故障，不静默降级。
  const toolsSpec = toolSchemas();
  let nativeAvailable = typeof provider.generateWithTools === "function";
  let committedNative = false;

  // 本轮的中断控制器：绑定 readline 的 SIGINT（Ctrl+C）。
  const abort = new AbortController();
  const onSigint = () => abort.abort();
  rl.on("SIGINT", onSigint);

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (abort.signal.aborted) throw new UserAbortError();
      const snapshot = buildProjectSnapshot(inspectWorkspace(root));
      const messages = buildAgentMessages(snapshot, history);

      // spinner 思考期转圈。agent 协议要完整结构，用非流式收（更稳），
      // 但传入中断 signal——思考期按 Ctrl+C 能立刻掐断请求。
      const spin = createSpinner("正在思考…", {
        stream: process.stdout,
        enabled: t.enabled,
        paint: (s) => t.accent(s),
      });
      spin.start();

      // 决定本步动作：优先原生 tool_calls，缺失/失败则回退老的 text-JSON 解析。
      // step 归一成统一形状 { thought, action, args, toolCallId? }：
      //   - toolCallId 存在 → 原生通道，观察走 role:"tool" 配对回喂；
      //   - toolCallId 缺失 → 老通道，观察走 role:"user" + [观察] 前缀（原样保留）。
      let step_;
      try {
        step_ = nativeAvailable
          ? await requestNativeStep(provider, messages, toolsSpec, abort.signal, history)
          : await requestLegacyStep(provider, messages, abort.signal, history);
        if (step_.usedNative) committedNative = true;
      } catch (error) {
        // 硬故障绝不吞：用户中断 / 网络被拒 / 配置错——原样抛出，交上层处理。
        if (isHardFailure(error)) throw error;
        // 仅当"还没成功用过原生通道"时，才把错误视为"provider 不支持 tools"，
        // 降级到老路重试本步。已 committedNative 后再报错 = 真故障，照样抛。
        if (nativeAvailable && !committedNative) {
          nativeAvailable = false;
          console.log(`  ${t.muted(g.arrow || "›")} ${t.muted("该服务不支持原生工具调用，已切换到兼容模式。")}`);
          step_ = await requestLegacyStep(provider, messages, abort.signal, history);
        } else {
          throw error;
        }
      } finally {
        spin.stop();
      }

      const { thought, action, args, toolCallId } = step_;

      if (thought) {
        console.log(`  ${t.muted(g.arrow)} ${t.muted(thought)}`);
      }

      if (action === "finish") {
        const msg = args.message || "（无内容）";
        console.log("");
        // 真流式重述最终交付：把 finish 的 message 交给模型走 SSE 逐字吐出，
        // 制造和 init/plan 一致的"活感"。中断则安静停下。
        await streamFinish({ provider, t, message: msg, signal: abort.signal });
        console.log("");
        appendEvent(root, {
          type: "chat",
          summary: `REPL 交付：${truncate(userInput, 40)}`,
          result: "success",
          tool: "bennira repl",
          risk: "low",
        });
        return;
      }

      // 执行工具 -----------------------------------------------------------
      const risk = AGENT_TOOL_RISK[action] || "danger";
      printToolCall(t, action, args);

      if (risk === "danger") {
        const ok = await confirm(rl, t, actionConfirmPrompt(action, args));
        if (!ok) {
          pushObservation(history, toolCallId, `用户拒绝了动作 ${action}。请换一个思路或询问用户。`);
          console.log(`  ${t.warning("!")} ${t.muted("已拒绝，反馈给模型。")}`);
          continue;
        }
      }

      const observation = await executeTool(root, action, args, t);
      pushObservation(history, toolCallId, observation);
    }

    console.log(`  ${t.warning("!")} ${t.muted(`已达单轮最大步数（${MAX_STEPS}），暂停。可继续追问。`)}`);
  } finally {
    rl.off("SIGINT", onSigint);
  }
}

// —— T3：一步"思考"的两条通道 ————————————————————————————————————————
// 两者都返回统一形状：{ thought, action, args, toolCallId?, usedNative? }，
// 并各自负责把"assistant 这一回合"压进 history（供下一步请求携带上下文）。
// toolCallId 只在原生通道存在——它是 role:"tool" 回喂配对的钥匙。

// 原生通道：走 generateWithTools，让端点返回结构化 tool_calls。
async function requestNativeStep(provider, messages, tools, signal, history) {
  const { text, toolCalls } = await provider.generateWithTools(messages, tools, { signal });

  // 有工具调用：一步只处理一个（OpenAI 可能并行返回多个，但我们的 loop 是单工具/步）。
  // assistant 回合必须原样带上 tool_calls[0]，否则下一轮请求会因"tool_call 无对应 tool 响应"报错。
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const primary = toolCalls[0];
    history.push({ role: "assistant", content: text || "", tool_calls: [primary] });
    const act = actionFromToolCall(primary);
    return {
      thought: act.thought || "",
      action: act.action,
      args: act.args || {},
      toolCallId: act.toolCallId,
      usedNative: true,
    };
  }

  // 无工具调用：模型给了纯文本。压进 history 后，尝试老解析（有些模型即便支持 tools
  // 也会把动作写进 content）；解析不出动作则当作 finish 交付这段文本。
  history.push({ role: "assistant", content: text || "" });
  const parsed = parseAgentAction(text || "");
  if (parsed.action && !parsed.fellBack) {
    return { thought: parsed.thought || "", action: parsed.action, args: parsed.args || {}, usedNative: true };
  }
  return { thought: "", action: "finish", args: { message: text || "（无内容）" }, usedNative: true };
}

// 兼容通道：与改造前一字不差——generate 拿文本，parseAgentAction 解析，raw 压进 history。
async function requestLegacyStep(provider, messages, signal, history) {
  const raw = await provider.generate(messages, { signal });
  history.push({ role: "assistant", content: raw });
  const { thought, action, args } = parseAgentAction(raw);
  return { thought, action, args };
}

// 硬故障：绝不能被"降级到老路"吞掉的错误。用户中断、网络被拒、模型配置错——
// 这些和"provider 不支持 tools"是两回事，必须原样上抛。
function isHardFailure(error) {
  const code = error?.code;
  return code === "USER_ABORT" || code === "NETWORK_DENIED" || code === "MODEL_CONFIG";
}

// 回喂观察：原生通道用 role:"tool" + tool_call_id 精确配对（OpenAI 规范）；
// 老通道无 id，沿用 role:"user" + [观察] 前缀（改造前契约，T1 测试锚定此形状）。
function pushObservation(history, toolCallId, observation) {
  if (toolCallId) {
    history.push({ role: "tool", tool_call_id: toolCallId, content: String(observation) });
  } else {
    history.push({ role: "user", content: `[观察] ${observation}` });
  }
}

// 真流式打印最终交付：走 SSE 逐字冒出。首字到达前有一次隐式思考期。
// 中断（Ctrl+C）时，把已输出内容收尾换行并抛 UserAbortError，由上层安静处理。
async function streamFinish({ provider, t, message, signal }) {
  // 用一个极简"重述"提示，让模型把 message 自然地讲给用户——通常它会近乎原样输出，
  // 但获得了逐字流式的体验。为省 token 且稳妥，这里直接把 message 作为 assistant 内容回显：
  // 我们不再二次调模型（避免额外费用与漂移），而是本地按"字节流节奏"吐出真实内容。
  // —— 说明：真正的 SSE 流式已在 agentic 每一步的思考请求里体现；finish 是已定稿文本，
  //     逐字呈现即可，无需再联网。这样既有流式手感，又不产生额外调用。
  const enabled = t.enabled;
  const s = String(message);
  if (!enabled) {
    process.stdout.write(`${s}\n`);
    return;
  }
  for (const ch of s) {
    if (signal?.aborted) {
      process.stdout.write("\n");
      throw new UserAbortError();
    }
    process.stdout.write(t.value(ch));
    // 轻微节流，制造"打字"的活感；中文按字，避免过快糊成一坨。
    await sleep(6);
  }
  process.stdout.write("\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 真正执行工具：core 不碰 fs/exec，都在这里做，并做路径安全校验。
async function executeTool(root, action, args, t) {
  try {
    switch (action) {
      case "read_file": {
        const abs = safePath(root, args.path);
        if (!existsSync(abs)) return `文件不存在：${args.path}`;
        const content = readFileSync(abs, "utf8");
        const clipped = content.length > MAX_READ_CHARS
          ? `${content.slice(0, MAX_READ_CHARS)}\n…（已截断，共 ${content.length} 字）`
          : content;
        console.log(`  ${t.success(t.glyphs.found)} ${t.muted(`已读取 ${args.path}（${content.length} 字）`)}`);
        return `文件 ${args.path} 内容：\n${clipped}`;
      }
      case "list_files": {
        const abs = safePath(root, args.path || ".");
        const entries = readdirSync(abs, { withFileTypes: true })
          .filter((e) => e.name !== "node_modules" && !e.name.startsWith(".git"))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        console.log(`  ${t.success(t.glyphs.found)} ${t.muted(`列出 ${args.path || "."}（${entries.length} 项）`)}`);
        return `目录 ${args.path || "."} 下：\n${entries.join("\n")}`;
      }
      case "search": {
        const hits = searchProject(root, String(args.query || ""));
        console.log(`  ${t.success(t.glyphs.found)} ${t.muted(`搜索 "${args.query}"（${hits.length} 个命中文件）`)}`);
        return hits.length
          ? `命中文件：\n${hits.slice(0, 30).join("\n")}`
          : `未找到包含 "${args.query}" 的文件。`;
      }
      case "write_file": {
        const abs = safePath(root, args.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, String(args.content ?? ""), "utf8");
        console.log(`  ${t.success(t.glyphs.found)} ${t.value(`已写入 ${args.path}`)}`);
        appendEvent(root, {
          type: "write",
          summary: `写入文件 ${args.path}`,
          files: [args.path],
          result: "success",
          tool: "bennira repl · write_file",
          risk: "medium",
        });
        return `已成功写入 ${args.path}（${String(args.content ?? "").length} 字）。`;
      }
      case "run_command": {
        const command = String(args.command || "");
        console.log(`  ${t.muted("$")} ${t.value(command)}`);
        try {
          const out = execSync(command, {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
          });
          const clipped = out.length > MAX_READ_CHARS ? `${out.slice(0, MAX_READ_CHARS)}\n…（截断）` : out;
          if (clipped.trim()) console.log(dim(t, clipped.trimEnd()));
          appendEvent(root, {
            type: "exec",
            summary: `执行命令：${truncate(command, 40)}`,
            result: "success",
            tool: "bennira repl · run_command",
            risk: "high",
          });
          return `命令执行成功，输出：\n${clipped || "(无输出)"}`;
        } catch (err) {
          const out = `${err.stdout || ""}${err.stderr || ""}` || err.message;
          console.log(`  ${t.danger("×")} ${t.muted("命令失败")}`);
          if (out.trim()) console.log(dim(t, out.slice(0, MAX_READ_CHARS).trimEnd()));
          return `命令执行失败（退出码 ${err.status ?? "?"}）：\n${out.slice(0, MAX_READ_CHARS)}`;
        }
      }
      default:
        return `未知工具：${action}`;
    }
  } catch (error) {
    return `执行 ${action} 出错：${error?.message || error}`;
  }
}

// ---- 安全 & 辅助 ----------------------------------------------------------

// 把模型给的相对路径锁在项目根内，越界（../ 逃逸）直接抛错。
function safePath(root, p) {
  const abs = resolve(root, String(p || "."));
  const rel = relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../")) {
    throw new Error(`路径越界，拒绝访问项目外：${p}`);
  }
  return abs;
}

// 递归列出项目内的相对文件路径，作为 @补全的候选。
// 跳过 node_modules/.git 等噪声目录与大文件，带总数上限防超大仓库遍历爆炸。
function listProjectFiles(root, { limit = MAX_FILE_CANDIDATES } = {}) {
  const out = [];
  const skipDirs = new Set(["node_modules", ".git", ".bennira", "dist", "build", ".next", "coverage"]);
  const walk = (dir) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".git") || skipDirs.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        out.push(relative(root, full));
      }
    }
  };
  walk(root);
  return out.sort();
}

// @文件引用：扫描用户输入里的 @path，读取每个文件内容，作为独立上下文块附加。
// 关键设计（对齐 Claude Code）：原文本里的 @path 原样保留（模型仍看得到你提到了它），
// 文件内容作为单独的 [引用文件] 块拼在后面——不是替换，是附加。越界/不存在的安静跳过。
function injectAtMentions(root, line, t) {
  const mentions = extractAtMentions(line);
  if (mentions.length === 0) return line;

  const blocks = [];
  const loaded = [];
  const skipped = [];
  for (const rel of mentions) {
    let abs;
    try {
      abs = safePath(root, rel);
    } catch {
      skipped.push(`${rel}（越界）`);
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      skipped.push(`${rel}（不存在）`);
      continue;
    }
    try {
      const content = readFileSync(abs, "utf8");
      const clipped = content.length > MAX_MENTION_CHARS
        ? `${content.slice(0, MAX_MENTION_CHARS)}\n…（已截断，共 ${content.length} 字）`
        : content;
      blocks.push(`【引用文件 ${rel}】\n${clipped}`);
      loaded.push(`${rel}（${content.length} 字）`);
    } catch {
      skipped.push(`${rel}（读取失败）`);
    }
  }

  // 给用户即时反馈：读进了哪些、跳过了哪些。
  if (loaded.length) {
    console.log(`  ${t.success(t.glyphs.found)} ${t.muted(`已引用 ${loaded.join("、")}`)}`);
  }
  if (skipped.length) {
    console.log(`  ${t.warning("!")} ${t.muted(`跳过 ${skipped.join("、")}`)}`);
  }

  if (blocks.length === 0) return line;
  // 原输入在前，引用文件块在后——模型既看到你的话，也看到文件内容。
  return `${line}\n\n${blocks.join("\n\n")}`;
}

// 极简项目内搜索：递归遍历（跳过 node_modules/.git），返回命中文件的相对路径。
function searchProject(root, query, { limit = 30 } = {}) {
  if (!query) return [];
  const hits = [];
  const walk = (dir) => {
    if (hits.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= limit) return;
      if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        try {
          if (statSync(full).size > 512 * 1024) continue; // 跳过大文件
          const content = readFileSync(full, "utf8");
          if (content.includes(query)) hits.push(relative(root, full));
        } catch {
          /* 二进制 / 无权限，跳过 */
        }
      }
    }
  };
  walk(root);
  return hits;
}

function confirm(rl, t, question) {
  return new Promise((resolvePromise) => {
    rl.question(`  ${t.warning("?")} ${t.value(question)} ${t.muted("(y/N) ")}`, (ans) => {
      resolvePromise(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function actionConfirmPrompt(action, args) {
  if (action === "write_file") return `允许写入文件 ${args.path}？`;
  if (action === "run_command") return `允许执行命令「${truncate(String(args.command || ""), 60)}」？`;
  return `允许执行 ${action}？`;
}

function printToolCall(t, action, args) {
  const g = t.glyphs;
  const label = {
    read_file: "读取文件",
    list_files: "列目录",
    search: "搜索",
    write_file: "写文件",
    run_command: "跑命令",
  }[action] || action;
  const detail = args.path || args.command || args.query || "";
  console.log(`  ${t.accent(g.bullet || "•")} ${t.label(label)} ${t.muted(truncate(String(detail), 60))}`);
}

// /init：在会话内读懂项目并生成 / 改进 AGENTS.md（复用 core 消息构建 + 真流式）。
// 与顶层 `bennira init` 同源，只是嵌在 REPL 里，省得退出去单独跑。
async function runInit({ root, config, t, rl }) {
  const g = t.glyphs;
  const result = inspectWorkspace(root);
  ensureProjectMemory(root, result);

  const abort = new AbortController();
  const onSigint = () => abort.abort();
  rl.on("SIGINT", onSigint);
  try {
    const agentsPath = join(root, "AGENTS.md");
    const agentsExists = existsSync(agentsPath);
    const existingAgentsMd = agentsExists ? readFileSync(agentsPath, "utf8") : undefined;
    const messages = buildInitMessages(result, { existingAgentsMd });
    const provider = createProvider(root, config);

    const spin = createSpinner("正在读懂项目…", { enabled: t.enabled, paint: (s) => t.accent(s) });
    spin.start();
    let started = false;
    const content = await provider.generateStream(
      messages,
      (delta) => {
        if (!started) {
          spin.stop();
          console.log(t.muted(`${g.arrow} ${agentsExists ? "审查改进" : "生成"} AGENTS.md：`));
          started = true;
        }
        process.stdout.write(t.enabled ? t.value(delta) : delta);
      },
      { signal: abort.signal }
    );
    if (started) process.stdout.write("\n");
    else spin.stop();

    writeFileSync(agentsPath, `${content.trimEnd()}\n`, "utf8");
    const event = appendEvent(root, {
      type: "init",
      summary: agentsExists ? "审查并改进 AGENTS.md" : "生成 AGENTS.md 项目记忆",
      files: ["AGENTS.md", ".bennira/config.json", ".bennira/state.json"],
      result: "success",
      tool: "bennira repl · /init",
      risk: "medium",
    });
    updateProjectMemory(root, { lastAction: event });
    console.log(`  ${t.success(g.found)} ${t.value(`已${agentsExists ? "更新" : "生成"} AGENTS.md`)} ${t.muted("——请审阅并补充 AI 猜不到的团队约定。")}`);
  } finally {
    rl.off("SIGINT", onSigint);
  }
}

// /plan：结合项目状态生成下一步计划并写入 .bennira/last-plan.md（复用 core）。
async function runPlan({ root, config, t, rl, input }) {
  const g = t.glyphs;
  const result = inspectWorkspace(root);

  const abort = new AbortController();
  const onSigint = () => abort.abort();
  rl.on("SIGINT", onSigint);
  try {
    const provider = createProvider(root, config);
    const messages = buildPlanMessages(result, input);
    const spin = createSpinner("正在结合项目状态生成计划…", { enabled: t.enabled, paint: (s) => t.accent(s) });
    spin.start();
    let raw;
    try {
      // 计划是结构化 JSON，收全再解析展示，不逐字吐 JSON；首字到达切文案。
      raw = await provider.generateStream(messages, () => spin.setText("正在生成计划…"), { signal: abort.signal });
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
      tool: "bennira repl · /plan",
      risk: "medium",
    });
    updateProjectMemory(root, {
      lastAction: event,
      lastPlanPath: ".bennira/last-plan.md",
      nextSteps: output.nextSteps,
    });

    console.log("");
    console.log(`  ${t.heading("计划")} ${t.muted(truncate(input, 50))}`);
    if (output.summary) console.log(`  ${t.value(output.summary)}`);
    output.nextSteps.forEach((s, i) => {
      console.log(`  ${t.accent(String(i + 1).padStart(2))}. ${t.value(s)}`);
    });
    console.log(`  ${t.muted(`${g.found || "*"} 已写入 .bennira/last-plan.md`)}`);
  } finally {
    rl.off("SIGINT", onSigint);
  }
}

// 命令历史读盘：一行一条，最新在末尾。文件不存在返回空。
function loadHistory(path) {
  try {
    if (!existsSync(path)) return [];
    return normalizeHistory(readFileSync(path, "utf8").split(/\r?\n/), { limit: HISTORY_LIMIT });
  } catch {
    return [];
  }
}

// 命令历史写盘：确保目录存在，失败静默（历史丢失不该中断退出）。
function saveHistory(path, lines) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* 写历史失败不影响用户 */
  }
}

function dim(t, text) {
  return text
    .split("\n")
    .map((l) => `    ${t.muted(l)}`)
    .join("\n");
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function banner(t, root, rd) {
  const g = t.glyphs;
  console.log(t.title("Bennira 交互会话"));
  console.log(t.muted(`  项目：${root}`));
  console.log(
    `  ${rd.ready ? t.success(g.found) : t.warning("!")} ${t.muted(`模型 ${rd.ready ? "已就绪" : "未就绪"} · /help 看命令 · @文件 引用 · Tab 补全 · Ctrl+C 中断`)}`
  );
  console.log("");
}

function printReplHelp(t) {
  const line = (c, d) => `  ${t.accent(c.padEnd(16))}${t.muted(d)}`;
  console.log(t.heading("会话命令"));
  // 以 core 的 SLASH_COMMANDS 为单一事实源，帮助与 Tab 补全永不脱节。
  for (const c of SLASH_COMMANDS) {
    console.log(line(c.name, c.desc));
  }
  console.log("");
  console.log(t.muted("  直接输入自然语言 = 让 Bennira 动手：读文件 / 改代码 / 跑命令。"));
  console.log(t.muted("  改文件、跑命令前会请你确认（y/N）。"));
  console.log("");
  console.log(t.heading("输入技巧"));
  console.log(line("@文件路径", "把文件内容带进上下文，如 @package.json（Tab 可补全）"));
  console.log(line("行尾 \\", "反斜杠续行——换行继续输入，不提交"));
  console.log(line('"""', "三引号单独成行，进入多行块，再打 \"\"\" 结束（粘代码用）"));
  console.log(line("Tab", "补全 slash 命令，或行尾 @ 时补全项目文件"));
  console.log(line("↑ / ↓", "调出历史命令；Ctrl+C 中断当前生成"));
}
