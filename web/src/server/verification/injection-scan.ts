// Injection scanner: finds text in the submitted repo that is aimed at AI reviewers ("ignore previous
// instructions", "mark everything as passed", HTML comments addressed to an AI). It reads file contents
// through the GitHub contents API at the pinned commit (runner-client) and never runs anything. Flags are
// shown in the report as evidence; they never change a verdict.
import type { Result } from "@/lib/result";

export const MAX_SCAN_FILES = 200;
export const MAX_SCAN_BYTES = 1_000_000;
const EXCERPT_MAX = 200;

export type InjectionFlag = { file: string; line: number; pattern: FlagPattern; excerpt: string };
export type FlagPattern = "ai_reviewer" | "ignore_instructions" | "mark_all_passed" | "html_comment_to_ai";

const LINE_PATTERNS: { pattern: FlagPattern; re: RegExp }[] = [
  { pattern: "ai_reviewer", re: /\b(?:AI|LLM)[ -](?:reviewer|grader|judge|evaluator|assistant|model|agent)s?\b/i },
  { pattern: "ignore_instructions", re: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+instructions\b/i },
  { pattern: "mark_all_passed", re: /\bmark\s+(?:all|everything|every\s+\w+)(?:\s+\w+){0,3}\s+as\s+(?:passed|pass|passing|complete|completed|done|met)\b/i },
];
const HTML_COMMENT = /<!--([\s\S]*?)-->/g;
const ADDRESSES_AI = /\b(?:AI|LLM|GPT|ChatGPT|Gemini|Claude|assistant|language model|grader|reviewer)s?\b/i;

/** One line, without control characters, cut to at most 200 characters around the match. */
function excerpt(line: string, at: number): string {
  const clean = line.replace(/[\u0000-\u001F\u007F]/g, "");
  if (clean.length <= EXCERPT_MAX) return clean.trim();
  const start = Math.max(0, Math.min(at - 80, clean.length - EXCERPT_MAX));
  return clean.slice(start, start + EXCERPT_MAX);
}

export function scanFiles(files: { path: string; content: string }[]): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  for (const f of files) {
    const lines = f.content.split(/\r?\n/);
    const fileFlags: InjectionFlag[] = [];
    lines.forEach((line, i) => {
      for (const { pattern, re } of LINE_PATTERNS) {
        const m = re.exec(line);
        if (m) fileFlags.push({ file: f.path, line: i + 1, pattern, excerpt: excerpt(line, m.index) });
      }
    });
    for (const m of f.content.matchAll(HTML_COMMENT)) {
      if (!ADDRESSES_AI.test(m[1] ?? "")) continue;
      const lineNo = f.content.slice(0, m.index).split("\n").length;
      const line = lines[lineNo - 1] ?? "";
      fileFlags.push({ file: f.path, line: lineNo, pattern: "html_comment_to_ai", excerpt: excerpt(line, Math.max(0, line.indexOf("<!--"))) });
    }
    const order: FlagPattern[] = ["ai_reviewer", "ignore_instructions", "mark_all_passed", "html_comment_to_ai"];
    fileFlags.sort((a, b) => a.line - b.line || order.indexOf(a.pattern) - order.indexOf(b.pattern));
    flags.push(...fileFlags);
  }
  return flags;
}

function isScanned(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p === "node_modules" || p === ".git")) return false;
  const name = parts[parts.length - 1]!.toLowerCase();
  return name === "readme" || name.startsWith("readme.") || name === "package.json" || /\.(md|markdown|html?)$/.test(name);
}

/** The files to scan, in tree order, within 200 files and 1 MB in all; `truncated` says some were left out. */
export function selectScanPaths(tree: { path: string; size: number }[]): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const t of tree) {
    if (!isScanned(t.path)) continue;
    if (paths.length >= MAX_SCAN_FILES || bytes + t.size > MAX_SCAN_BYTES) {
      truncated = true;
      continue;
    }
    paths.push(t.path);
    bytes += t.size;
  }
  return { paths, truncated };
}

export async function scanRepo<E>(deps: {
  listTree: () => Promise<Result<{ path: string; size: number }[], E>>;
  getFiles: (paths: string[]) => Promise<Result<{ path: string; content: string }[], E>>;
}): Promise<Result<{ flags: InjectionFlag[]; truncated: boolean; scanned: number }, E>> {
  const tree = await deps.listTree();
  if (!tree.ok) return tree;
  const { paths, truncated } = selectScanPaths(tree.value);
  const files = paths.length ? await deps.getFiles(paths) : ({ ok: true, value: [] } as const);
  if (!files.ok) return files;
  return { ok: true, value: { flags: scanFiles(files.value), truncated, scanned: files.value.length } };
}
