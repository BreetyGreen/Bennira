import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".bennira",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

export const DEFAULT_PROJECT_DOCS = [
  "README.md",
  "AGENTS.md",
  "docs/ONE_PAGE.md",
  "docs/CONTEXT_GUIDE.md",
  "docs/PRODUCT_DEFINITION.md",
  "docs/ARCHITECTURE.md",
  "docs/THIEF_MVP.md",
  "docs/ROADMAP.md",
];

export function inspectWorkspace(inputPath = process.cwd(), options = {}) {
  const cwd = resolve(inputPath);
  const gitRoot = findGitRoot(cwd);
  const root = gitRoot ?? cwd;
  const files = listFiles(root, {
    maxFiles: options.maxFiles ?? 200,
    maxDepth: options.maxDepth ?? 4,
  });
  const docs = readProjectDocs(root);

  return {
    root,
    gitRoot,
    isGitRepo: Boolean(gitRoot),
    packageKind: detectPackageKind(files),
    files,
    docs,
    bennira: {
      hasConfig: existsSync(join(root, ".bennira", "config.json")),
      hasState: existsSync(join(root, ".bennira", "state.json")),
    },
  };
}

function findGitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function listFiles(root, options) {
  const output = [];

  function walk(dir, depth) {
    if (output.length >= options.maxFiles || depth > options.maxDepth) {
      return;
    }

    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (output.length >= options.maxFiles) {
        return;
      }
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      output.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      }
    }
  }

  walk(root, 0);
  return output;
}

function readProjectDocs(root) {
  return DEFAULT_PROJECT_DOCS.map((path) => {
    const abs = join(root, path);
    try {
      const stat = statSync(abs);
      if (!stat.isFile()) {
        return { path, exists: false };
      }
      const content = readFileSync(abs, "utf8");
      return {
        path,
        exists: true,
        bytes: stat.size,
        title: extractTitle(content) ?? basename(path),
        summary: summarizeMarkdown(content),
      };
    } catch {
      return { path, exists: false };
    }
  });
}

function extractTitle(content) {
  const line = content.split(/\r?\n/).find((item) => item.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : null;
}

function summarizeMarkdown(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));
  return lines.slice(0, 3).join(" ");
}

function detectPackageKind(files) {
  if (files.includes("package.json")) {
    return "node";
  }
  if (files.includes("pyproject.toml")) {
    return "python";
  }
  if (files.includes("Cargo.toml")) {
    return "rust";
  }
  if (files.includes("go.mod")) {
    return "go";
  }
  return "unknown";
}
