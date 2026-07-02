import { createTheme, listThemes, padDisplay } from "./theme.mjs";

// 所有 format 函数接收一个可选 theme。缺省时创建一个「无色」主题，
// 保证纯文本降级路径和旧调用点都能正常工作。
function ensureTheme(theme) {
  return theme ?? createTheme({}, { enabled: false });
}

function riskTone(t, risk) {
  switch (risk) {
    case "high":
      return t.danger(risk);
    case "medium":
      return t.warning(risk);
    default:
      return t.muted(risk);
  }
}

function resultTone(t, result) {
  if (result === "success") return t.success(result);
  if (result === "fail" || result === "error") return t.danger(result);
  return t.info(String(result));
}

export function formatInspectResult(result, theme) {
  const t = ensureTheme(theme);
  const g = t.glyphs;
  const lines = [];
  lines.push(t.title("Bennira · inspect"));
  lines.push("");
  lines.push(t.kv("项目根目录", result.root));
  lines.push(t.kv("Git 仓库", result.isGitRepo ? "是" : "否"));
  lines.push(t.kv("项目类型", result.packageKind));
  lines.push("");
  lines.push(t.heading("关键文档"));
  for (const doc of result.docs) {
    const mark = doc.exists ? t.success(g.found) : t.danger(g.missing);
    const title = doc.title ? t.muted(`  ${doc.title}`) : "";
    lines.push(`  ${mark} ${t.value(doc.path)}${title}`);
  }
  lines.push("");
  lines.push(t.heading("文件概览"));
  const shown = result.files.slice(0, 40);
  shown.forEach((file) => {
    lines.push(`  ${t.muted(g.bullet)} ${t.value(file)}`);
  });
  if (result.files.length > 40) {
    lines.push(`  ${t.muted(`… 还有 ${result.files.length - 40} 项`)}`);
  }
  return lines.join("\n");
}

export function formatStatus(memory, events, theme) {
  const t = ensureTheme(theme);
  const g = t.glyphs;
  const lines = [];
  lines.push(t.title("Bennira · status"));
  lines.push("");
  if (!memory) {
    lines.push(t.warning("尚未初始化 .bennira/"));
    lines.push(`${t.muted("建议运行")} ${t.accent("bennira init")}`);
    return lines.join("\n");
  }

  lines.push(t.kv("阶段", memory.stage));
  lines.push(t.kv("版本线", memory.versionLine));
  lines.push(t.kv("项目根目录", memory.projectRoot));
  lines.push(t.kv("更新时间", memory.updatedAt));
  lines.push("");
  lines.push(t.heading("最近事件"));
  if (events.length === 0) {
    lines.push(`  ${t.muted("暂无事件")}`);
  } else {
    events.forEach((event) => {
      lines.push(
        `  ${t.muted(event.time)} ${t.accent(event.type)} ${t.muted(g.chevron)} ${t.value(event.summary)}`
      );
    });
  }
  return lines.join("\n");
}

export function formatEvents(events, warnings = [], theme) {
  const t = ensureTheme(theme);
  const g = t.glyphs;
  const lines = [];
  lines.push(t.title("Bennira · log"));
  lines.push("");
  if (events.length === 0) {
    lines.push(`  ${t.muted("暂无事件")}`);
  } else {
    events.forEach((event) => {
      lines.push(
        `  ${t.muted(event.time)} ${t.accent(event.type)} ${t.muted(g.chevron)} ${t.value(event.summary)}`
      );
      if (event.files?.length) {
        lines.push(`    ${t.label("files")} ${t.muted(event.files.join(", "))}`);
      }
      if (event.result) {
        lines.push(`    ${t.label("result")} ${resultTone(t, event.result)}   ${t.label("risk")} ${riskTone(t, event.risk)}`);
      }
      if (event.next?.length) {
        event.next.forEach((step) => {
          lines.push(`    ${t.muted(g.arrow)} ${t.value(step)}`);
        });
      }
    });
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push(t.warning("日志警告"));
    warnings.forEach((warning) => {
      lines.push(`  ${t.danger(g.missing)} ${t.muted(`第 ${warning.line} 行：${warning.message}`)}`);
    });
  }
  return lines.join("\n");
}

export function formatPlan(plan, theme) {
  const t = ensureTheme(theme);
  const g = t.glyphs;
  const lines = [];
  lines.push(t.title("Bennira 小偷 Alpha 计划"));
  lines.push("");
  lines.push(t.kv("用户输入", plan.input));
  lines.push("");
  lines.push(t.value(plan.summary));
  lines.push("");
  lines.push(t.heading("观察"));
  lines.push(`  ${t.label("Git 仓库")} ${t.value(plan.observed.isGitRepo ? "是" : "否")}`);
  lines.push(`  ${t.label("项目类型")} ${t.value(plan.observed.packageKind)}`);
  lines.push(`  ${t.label("已有文档")} ${t.value(plan.observed.docsFound.join("、") || "无")}`);
  lines.push(`  ${t.label("缺失文档")} ${t.value(plan.observed.docsMissing.join("、") || "无")}`);
  lines.push("");
  lines.push(t.heading("下一步"));
  for (const step of plan.nextSteps) {
    lines.push(`  ${t.muted(g.arrow)} ${t.value(step)}`);
  }
  return lines.join("\n");
}

// 计划写入 last-plan.md 时用的纯 Markdown 版本（不带 ANSI），
// 保证落盘文档干净可读。
export function formatPlanMarkdown(plan) {
  const lines = [];
  lines.push("# Bennira 小偷 Alpha 计划");
  lines.push("");
  lines.push(`用户输入：${plan.input}`);
  lines.push("");
  lines.push(plan.summary);
  lines.push("");
  lines.push("## 观察");
  lines.push("");
  lines.push(`- Git 仓库：${plan.observed.isGitRepo ? "是" : "否"}`);
  lines.push(`- 项目类型：${plan.observed.packageKind}`);
  lines.push(`- 已有文档：${plan.observed.docsFound.join("、") || "无"}`);
  lines.push(`- 缺失文档：${plan.observed.docsMissing.join("、") || "无"}`);
  lines.push("");
  lines.push("## 下一步");
  lines.push("");
  for (const step of plan.nextSteps) {
    lines.push(`- ${step}`);
  }
  return lines.join("\n");
}

// theme 相关展示 -------------------------------------------------------------

export function formatThemeList(config, theme) {
  const t = ensureTheme(theme);
  const g = t.glyphs;
  const items = listThemes(config);
  const lines = [];
  lines.push(t.title("Bennira · 配色主题"));
  lines.push("");
  lines.push(t.heading("八方旅人职业预设"));
  items
    .filter((item) => item.kind === "preset")
    .forEach((item) => {
      const marker = item.active ? t.success(g.found) : t.muted(" ");
      const name = item.active ? t.accent(padDisplay(item.id, 12)) : t.value(padDisplay(item.id, 12));
      const who = item.character ? t.muted(`（${item.character}）`) : "";
      lines.push(`  ${marker} ${item.sigil} ${name} ${t.label(item.job)}${who}  ${t.muted(item.brand)}`);
    });

  const customs = items.filter((item) => item.kind === "custom");
  if (customs.length > 0) {
    lines.push("");
    lines.push(t.heading("自定义主题"));
    customs.forEach((item) => {
      const marker = item.active ? t.success(g.found) : t.muted(" ");
      const name = item.active ? t.accent(item.id) : t.value(item.id);
      lines.push(`  ${marker} ${item.sigil} ${name}  ${t.label(item.job)}  ${t.muted(item.brand)}`);
    });
  }
  lines.push("");
  lines.push(t.muted(`切换：bennira theme use <id>    自定义：bennira theme set <token> <#hex>`));
  return lines.join("\n");
}

export function formatThemeShow(config, theme) {
  const t = ensureTheme(theme);
  const lines = [];
  lines.push(t.title("Bennira · 当前主题"));
  lines.push("");
  lines.push(t.kv("主题", `${t.id}`));
  lines.push(t.kv("职业", t.character ? `${t.job}（${t.character}）` : t.job));
  lines.push(t.kv("标志", t.sigil));
  lines.push(t.kv("上色", t.enabled ? "启用" : "已降级为纯文本"));
  lines.push("");
  lines.push(t.heading("语义色板"));
  const tokens = [
    ["brand", "品牌 / 主标题"],
    ["accent", "强调 / 命令名"],
    ["heading", "次级标题"],
    ["label", "键名"],
    ["value", "正文"],
    ["muted", "次要信息"],
    ["success", "成功"],
    ["warning", "警告"],
    ["danger", "风险"],
    ["info", "提示"],
  ];
  for (const [token, desc] of tokens) {
    const swatch = t[token] ? t[token]("██") : "██";
    lines.push(`  ${swatch} ${t.label(token.padEnd(8))} ${t.muted(desc)}  ${t.muted(t.colors[token])}`);
  }
  return lines.join("\n");
}
