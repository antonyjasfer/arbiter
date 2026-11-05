// Control characters (NUL and the rest of C0, plus DEL) are rejected in user text with a clear error.
// Postgres refuses NUL outright, so without this check a pasted NUL became a 500. Multi-line text keeps
// tab, line feed and carriage return; single-line text (titles) allows none.
const MULTILINE_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_FORBIDDEN = /[\u0000-\u001F\u007F]/;

export function hasControlChars(text: string, kind: "line" | "multiline"): boolean {
  return (kind === "line" ? LINE_FORBIDDEN : MULTILINE_FORBIDDEN).test(text);
}
