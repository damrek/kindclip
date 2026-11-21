import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BASELINE_FILE = ".comments-baseline.json";

const MARKUP = new Set([".html"]);
const C_LIKE = new Set([".ts", ".js", ".mjs", ".mts", ".cts", ".svelte", ".css"]);
const RUST = new Set([".rs"]);
const HASH = new Set([".sh", ".yml", ".yaml", ".toml"]);
const SQL = new Set([".sql"]);

const DIRECTIVE =
  /^(eslint-disable|eslint-enable|eslint |@ts-(expect-error|ignore|nocheck)|svelte-ignore|prettier-ignore|biome-ignore|@vitest-environment|<reference|global )/;

export const SUPPORTED_EXTENSIONS = new Set([
  ...C_LIKE,
  ...MARKUP,
  ...RUST,
  ...HASH,
  ...SQL,
]);

export function normalizeComment(body) {
  return body
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\*+\s?/, "")
        .replace(/^\s*[!/]+\s?/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDirective(text) {
  return DIRECTIVE.test(text);
}

function collectC(text, rust) {
  const out = [];
  let index = 0;
  let line = 1;
  let state = null;
  let startLine = 0;
  let startColumn = 0;
  let buffer = "";

  const push = (kind, endLine) => {
    const text = normalizeComment(buffer);
    if (text) {
      out.push({ kind, startLine, endLine, column: startColumn, text });
    }
    state = null;
    buffer = "";
  };

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] ?? "";

    if (state === null) {
      if (char === "/" && next === "/") {
        state = "line";
        startLine = line;
        startColumn = index - text.lastIndexOf("\n", index - 1);
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        startLine = line;
        startColumn = index - text.lastIndexOf("\n", index - 1);
        index += 2;
        continue;
      }
      if (char === "\n") {
        line += 1;
      }
      if (rust && char === "r") {
        const raw = /^r(#*)"/.exec(text.slice(index));
        if (raw) {
          const close = `"${raw[1]}`;
          const end = text.indexOf(close, index + raw[0].length);
          if (end === -1) break;
          line += (text.slice(index, end).match(/\n/g) ?? []).length;
          index = end + close.length;
          continue;
        }
      }
      if (char === "'" || char === '"' || char === "`") {
        if (rust && char === "'") {
          if (text[index + 1] === "\\" || text[index + 2] === "'") {
            state = "'";
            index += 1;
            continue;
          }
          index += 2;
          continue;
        }
        state = char;
      }
      index += 1;
      continue;
    }

    if (state === "line") {
      if (char === "\n") {
        push("line", line);
        line += 1;
        index += 1;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (state === "block") {
      if (char === "*" && next === "/") {
        push("block", line);
        index += 2;
        continue;
      }
      if (char === "\n") line += 1;
      buffer += char;
      index += 1;
      continue;
    }

    if (char === "\\") {
      if (next === "\n") line += 1;
      index += 2;
      continue;
    }
    if (char === state) {
      state = null;
      index += 1;
      continue;
    }
    if (char === "\n") {
      line += 1;
      if (state !== "`") state = null;
    }
    index += 1;
  }

  return out;
}

function collectHtml(text) {
  const out = [];
  const pattern = /<!--([\s\S]*?)-->/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const startLine = (before.match(/\n/g) ?? []).length + 1;
    const endLine = startLine + (match[0].match(/\n/g) ?? []).length;
    const value = normalizeComment(match[1]);
    if (value) {
      out.push({ kind: "html", startLine, endLine, column: 1, text: value });
    }
  }
  return out;
}

function collectHash(text, trackHeredoc) {
  const out = [];
  let heredoc = null;
  text.split("\n").forEach((raw, offset) => {
    const line = raw;
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null;
      return;
    }
    const opened = /<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(line);
    if (trackHeredoc && opened && !line.trimStart().startsWith("#")) {
      heredoc = opened[1];
      return;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#!")) return;
    if (!trimmed.startsWith("#")) return;
    const value = normalizeComment(trimmed.slice(1));
    if (value) {
      out.push({ kind: "hash", startLine: offset + 1, endLine: offset + 1, column: 1, text: value });
    }
  });
  return out;
}

function collectSql(text) {
  const out = [];
  text.split("\n").forEach((raw, offset) => {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("--")) return;
    const value = normalizeComment(trimmed.slice(2));
    if (value) {
      out.push({ kind: "sql", startLine: offset + 1, endLine: offset + 1, column: 1, text: value });
    }
  });
  return out;
}

export function extractComments(text, extension) {
  let found;
  if (C_LIKE.has(extension)) {
    found = collectC(text, false);
    if (extension === ".svelte") found = found.concat(collectHtml(text));
  } else if (MARKUP.has(extension)) {
    found = collectHtml(text);
  } else if (RUST.has(extension)) {
    found = collectC(text, true);
  } else if (HASH.has(extension)) {
    found = collectHash(text, extension === ".sh");
  } else if (SQL.has(extension)) {
    found = collectSql(text);
  } else {
    return [];
  }
  return found.map((comment) => ({ ...comment, directive: isDirective(comment.text) }));
}

export function countComments(comments) {
  return comments.filter((comment) => !comment.directive).length;
}

export function compareCount(comments, cap = 0) {
  const count = countComments(comments);
  return { count, cap, excess: Math.max(0, count - cap), lower: Math.max(0, cap - count) };
}

export function lowerBaseline(cap, comments) {
  return Math.min(cap, countComments(comments));
}

export function initBaseline(comments) {
  return countComments(comments);
}

export function trackedFiles(root) {
  const output = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !file.startsWith("docs/"))
    .filter((file) => !file.startsWith("odd/"))
    .filter((file) => !file.startsWith("node_modules/"))
    .filter((file) => !file.startsWith("dist/"))
    .filter((file) => !file.startsWith("target/"))
    .filter((file) => !file.startsWith("src-tauri/target/"))
    .filter((file) => !file.startsWith("src-tauri/gen/"))
    .sort();
}

export function scan(root, files) {
  const result = new Map();
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    result.set(file, extractComments(text, path.extname(file)));
  }
  return result;
}

export function loadBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  if (!existsSync(file)) return { version: 1, files: {} };
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveBaseline(root, baseline) {
  writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(baseline, null, 2)}\n`);
}

const ESLINT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".mts", ".cts", ".svelte"]);

function main(argv) {
  const root = process.cwd();
  const mode = argv.includes("--init") ? "init" : argv.includes("--update") ? "update" : "check";
  const stats = argv.includes("--stats");

  if (stats) {
    const all = scan(root, trackedFiles(root));
    let units = 0;
    let lines = 0;
    for (const comments of all.values()) {
      for (const comment of comments) {
        units += 1;
        lines += comment.endLine - comment.startLine + 1;
      }
    }
    console.log(`${units} comment units, ${lines} comment lines in ${all.size} files`);
    return;
  }

  const baseline = loadBaseline(root);
  if (mode === "init" && existsSync(path.join(root, BASELINE_FILE)) && !argv.includes("--force")) {
    console.error(`${BASELINE_FILE} already exists; --init would grandfather current comments. Use --force to override.`);
    process.exitCode = 1;
    return;
  }
  const everything = scan(root, trackedFiles(root));

  if (mode === "init" || mode === "update") {
    const next = { version: 1, files: { ...baseline.files } };
    for (const [file, comments] of everything) {
      const current = baseline.files[file] ?? 0;
      const updated =
        mode === "init" ? initBaseline(comments) : lowerBaseline(current, comments);
      if (updated > 0) next.files[file] = updated;
      else delete next.files[file];
    }
    saveBaseline(root, next);
    console.log(`${mode === "init" ? "wrote" : "lowered"} ${BASELINE_FILE}`);
    return;
  }

  let failures = 0;
  for (const [file, comments] of everything) {
    if (ESLINT_EXTENSIONS.has(path.extname(file))) continue;
    const { count, cap, excess, lower } = compareCount(comments, baseline.files[file] ?? 0);
    if (excess > 0) {
      failures += 1;
      console.log(`${file}: ${count} comments, baseline allows ${cap}`);
    }
    if (lower > 0) {
      failures += 1;
      console.log(`${file}: baseline can be lowered from ${cap} to ${count}`);
    }
  }
  if (failures > 0) {
    console.log(`\n${failures} comment-ratchet failure(s). Run \`npm run comments:update\` after removing comments.`);
    process.exitCode = 1;
    return;
  }
  console.log("comment ratchet ok");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
