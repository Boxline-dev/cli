/**
 * Output helpers: colours (only on a terminal, never with NO_COLOR), tables, numbers, times and error lines. Pure
 * functions, so the unit tests can check exactly what people see.
 */

export interface Style {
  readonly enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
}

type Env = Record<string, string | undefined>;

/**
 * Colours for one stream: on a terminal (not TERM=dumb) unless NO_COLOR is set to anything but "" (no-color.org).
 * FORCE_COLOR (not "0") turns them on without a terminal; NO_COLOR still wins.
 */
export function colorEnabled(stream: { isTTY?: boolean }, env: Env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY) && env.TERM !== "dumb";
}

export function makeStyle(enabled: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) => (enabled && s ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return { enabled, bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39) };
}

export const plain = makeStyle(false);

// ------------------------------------------------------------------ numbers and times

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** 812 ms · 12.3 s · 5m 02s · 3h 12m */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  if (ms === 0) return "0 s";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** Dollars: four decimals under a dollar (sessions cost fractions of a cent), two above. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n === 0) return "$0.00";
  if (n > 0 && n < 0.0001) return "<$0.0001";
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "?";
}

/** "5m ago", "in 4m", "just now" (compared with `now`). */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "–";
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < 5_000) return "just now";
  const units: [number, string][] = [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "m"],
    [1000, "s"],
  ];
  const [size, unit] = units.find(([u]) => abs >= u)!;
  const text = `${Math.floor(abs / size)}${unit}`;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/** "2026-09-30 14:03" in the computer's own time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ------------------------------------------------------------------ text

// Kept apart so the pattern holds no literal control character (the linter flags those).
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
export const stripAnsi = (s: string) => s.replace(ANSI, "");

/** Visible width (ANSI colour codes take none). */
export const width = (s: string) => [...stripAnsi(s)].length;

/** One line, at most `max` characters, with "…" when cut. */
export function oneLine(s: string, max = 100): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join("")}…` : flat;
}

/**
 * Columns padded to their widest cell, two spaces apart; the header in bold. The last column is not padded, so long
 * titles and URLs do not drag trailing spaces.
 */
export function table(headers: string[], rows: string[][], style: Style = plain): string {
  if (rows.length === 0) return "";
  const widths = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const line = (cells: string[], head = false) =>
    cells
      .map((c, i) => {
        const text = head ? style.bold(c) : c;
        return i === cells.length - 1 ? text : text + " ".repeat(widths[i]! - width(c));
      })
      .join("  ")
      .trimEnd();
  return [line(headers, true), ...rows.map((r) => line(r))].join("\n") + "\n";
}

/** "Label   value" lines with the labels padded to the widest one. Rows whose value is undefined are left out. */
export function details(rows: [string, string | undefined][], style: Style = plain): string {
  const shown = rows.filter((r): r is [string, string] => r[1] !== undefined);
  const w = Math.max(0, ...shown.map(([k]) => width(k)));
  return shown.map(([k, v]) => `${style.dim(k.padEnd(w))}  ${v}`).join("\n") + "\n";
}

/**
 * Keeps stdout and stderr lines apart when both go to one terminal. The session's shell may send a line's final
 * newline late (after the other stream wrote), which would glue "hello" and "error" into one line: the open line is
 * ended first, and its late newline skipped. Only for terminals: piped output is passed on byte for byte.
 */
export class LineGuard {
  private open: string | null = null;
  private readonly owes = new Set<string>();

  next(stream: string, data: string): string {
    if (this.owes.delete(stream) && data.startsWith("\n")) data = data.slice(1);
    if (!data) return "";
    let out = data;
    if (this.open && this.open !== stream) {
      out = `\n${data}`;
      this.owes.add(this.open);
    }
    this.open = data.endsWith("\n") ? null : stream;
    return out;
  }
}

// ------------------------------------------------------------------ errors

/** A mistake in the command line itself (exit code 2). */
export class UsageError extends Error {
  constructor(
    message: string,
    /** The command whose help to point at, e.g. "sessions create". */
    readonly command?: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

/** A problem the CLI found itself (no API key, a file it cannot read…), exit code 1. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code = "cli_error",
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** The fields of an SDK error we show; read by shape so this module needs no SDK at run time. */
interface ApiErrorLike {
  message: string;
  code?: string;
  status?: number;
  requestId?: string | null;
}

const isApiError = (e: unknown): e is ApiErrorLike & Error =>
  e instanceof Error && typeof (e as { code?: unknown }).code === "string" && typeof (e as { status?: unknown }).status === "number";

/** "Error: <message> (request id req_…)"; the request id only when the API answered. */
export function errorLine(err: unknown): string {
  if (isApiError(err)) return `Error: ${err.message}${err.requestId ? ` (request id ${err.requestId})` : ""}`;
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Error: ${String(err)}`;
}

/** The machine form of an error, for --json. */
export function errorJson(err: unknown): { error: { code: string; message: string; status?: number; requestId?: string | null } } {
  if (isApiError(err)) return { error: { code: err.code!, message: err.message, status: err.status, requestId: err.requestId ?? null } };
  if (err instanceof UsageError) return { error: { code: "usage", message: err.message } };
  if (err instanceof CliError) return { error: { code: err.code, message: err.message } };
  return { error: { code: "error", message: err instanceof Error ? err.message : String(err) } };
}

/** Pretty JSON with a final newline (what --json prints). */
export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
