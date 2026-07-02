import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EVENT_FIELDS = [
  "time",
  "type",
  "summary",
  "input",
  "files",
  "result",
  "next",
  "tool",
  "risk",
];

export function appendEvent(root, event) {
  const path = join(root, ".bennira", "logs", "events.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  const record = normalizeEvent(event);
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export function readEvents(root, limit = 20) {
  return readEventLog(root, { limit }).events;
}

export function readEventLog(root, options = {}) {
  const path = join(root, ".bennira", "logs", "events.jsonl");
  const limit = options.limit ?? 20;
  try {
    const lines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    const events = [];
    const warnings = [];

    lines.forEach((line, index) => {
      try {
        events.push(normalizeEvent(JSON.parse(line)));
      } catch (error) {
        warnings.push({
          line: index + 1,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return {
      events: events.slice(-limit),
      warnings,
    };
  } catch {
    return {
      events: [],
      warnings: [],
    };
  }
}

export function normalizeEvent(event = {}) {
  return {
    time: typeof event.time === "string" ? event.time : new Date().toISOString(),
    type: typeof event.type === "string" && event.type ? event.type : "unknown",
    summary: typeof event.summary === "string" ? event.summary : "",
    input: event.input ?? null,
    files: Array.isArray(event.files) ? event.files : [],
    result: event.result ?? null,
    next: Array.isArray(event.next) ? event.next : [],
    tool: event.tool ?? null,
    risk: event.risk ?? "low",
  };
}
