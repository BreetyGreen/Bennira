// repl.mjs —— 交互式会话（持久 REPL + agentic 循环）
// -----------------------------------------------------------------------------
// 这是 Bennira 从"一次性命令"进化到"活着的会话"的地方。抄 Codex / Claude Code：
//   1. 持久 readline 循环：进来一次，连续对话，不用每次敲一长串 node ...。
//   2. 流式输出：模型回答逐字冒出来。
//   3. spinner：思考期转圈，消灭干等。
//   4. agentic：模型能读文件、改文件、跑命令——危险动作先请你确认。
//
// slash 命令：/help /status /plan /init /clear /exit
// 直接输入自然语言 = 进入 agentic 循环，让 Bennira 动手办事。

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
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
  AGENT_TOOL_RISK,
  appendEvent,
} from "@bennira/core";

const MAX_STEPS = 12; // 单轮 agentic 循环的最大工具调用步数，防跑飞
const MAX_READ_CHARS = 6000; // 单个 read_file 回喂给模型的字符上限

export async function repl(args) {
  const root = inspectWorkspace(process.cwd()).root;
  const config = readConfig(root);
  const t = createTheme(config, args.includes("--no-color") ? { enabled: false } : {});
  const g = t.glyphs;

  const rd = modelReadiness(root, config);
  banner(t, root, rd);
  if (!rd.ready) {
    console.log(
      `${t.danger(g.missing)} ${t.danger("模型未就绪")} ${t.muted("——先运行 ")}${t.accent("bennira setup")}${t.muted(" 接上模型，REPL 才能对话。")}`
    );
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => t.accent(`${t.sigil} `);
  rl.setPrompt(prompt());

  // 会话级 agentic 历史（跨轮累积，形成"记忆"）。
  let history = [];

  rl.prompt();
  for await (const lineRaw of rl) {
    const line = lineRaw.trim();
    if (!line) {
      rl.prompt();
      continue;
    }

    // slash 命令 -----------------------------------------------------------
    if (line.startsWith("/")) {
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
      // 未知 slash：当作自然语言（去掉斜杠）继续
      console.log(t.muted(`未知命令 /${cmd}，当作提问处理。输入 /help 看可用命令。`));
    }

    // 自然语言 → agentic 循环 ---------------------------------------------
    try {
      await runAgentTurn({ root, config, t, rl, history, userInput: line });
    } catch (error) {
      console.log(`${t.danger(g.missing || "×")} ${t.danger(error?.message || String(error))}`);
    }
    rl.prompt();
  }

  rl.close();
}

// 一轮 agentic 循环：用户说一句 → 模型思考/调工具 → 直到 finish 或触顶。
async function runAgentTurn({ root, config, t, rl, history, userInput }) {
  const g = t.glyphs;
  const provider = createProvider(root, config);
  history.push({ role: "user", content: userInput });

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const snapshot = buildProjectSnapshot(inspectWorkspace(root));
    const messages = buildAgentMessages(snapshot, history);

    // spinner 思考 → 流式（这里 agent 协议要的是完整 JSON，用非流式更稳；
    // 但为了"活感"，finish 的最终消息我们单独走流式重述）。
    const spin = createSpinner("正在思考…", {
      stream: process.stdout,
      enabled: t.enabled,
      paint: (s) => t.accent(s),
    });
    spin.start();
    let raw;
    try {
      raw = await provider.generate(messages);
    } finally {
      spin.stop();
    }

    const { thought, action, args } = parseAgentAction(raw);
    history.push({ role: "assistant", content: raw });

    if (thought) {
      console.log(`  ${t.muted(g.arrow)} ${t.muted(thought)}`);
    }

    if (action === "finish") {
      const msg = args.message || "（无内容）";
      console.log("");
      streamLike(msg, t);
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
        history.push({
          role: "user",
          content: `[观察] 用户拒绝了动作 ${action}。请换一个思路或询问用户。`,
        });
        console.log(`  ${t.warning("!")} ${t.muted("已拒绝，反馈给模型。")}`);
        continue;
      }
    }

    const observation = await executeTool(root, action, args, t);
    history.push({ role: "user", content: `[观察] ${observation}` });
  }

  console.log(`  ${t.warning("!")} ${t.muted(`已达单轮最大步数（${MAX_STEPS}），暂停。可继续追问。`)}`);
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

// "类流式"打印：逐字吐出 finish 的最终消息，制造活感（不额外调模型）。
function streamLike(text, t) {
  if (!t.enabled) {
    process.stdout.write(`${text}\n`);
    return;
  }
  // 同步逐字写入。中文按字，速度自适应长度，避免太长时卡顿。
  const s = String(text);
  for (const ch of s) {
    process.stdout.write(t.value(ch));
  }
  process.stdout.write("\n");
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
    `  ${rd.ready ? t.success(g.found) : t.warning("!")} ${t.muted(`模型 ${rd.ready ? "已就绪" : "未就绪"} · 输入 /help 看命令 · /exit 退出`)}`
  );
  console.log("");
}

function printReplHelp(t) {
  const line = (c, d) => `  ${t.accent(c.padEnd(16))}${t.muted(d)}`;
  console.log(t.heading("会话命令"));
  console.log(line("/help", "显示本帮助"));
  console.log(line("/status", "查看模型就绪状态"));
  console.log(line("/clear", "清空会话上下文（忘掉之前的对话）"));
  console.log(line("/exit", "退出会话"));
  console.log("");
  console.log(t.muted("  直接输入自然语言 = 让 Bennira 动手：读文件 / 改代码 / 跑命令。"));
  console.log(t.muted("  改文件、跑命令前会请你确认（y/N）。"));
}
