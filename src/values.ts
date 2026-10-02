/** Turns option values into API parameters. Pure, so the unit tests can check every form. */
import type { AgentVariable, ProxyOption, SessionStatus } from "@boxline/sdk";
import { UsageError } from "./output.js";

/** The API's variable names (docs/CONTRACT.md "Agent variables"). */
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * --proxy: `residential`, `residential:DE`, `datacenter[:CC]`, a proxy URL (`http://user:pass@host:port`, your own
 * proxy) or the API's JSON form (`{"type":"residential","country":"US"}`, or a list of rules).
 */
export function parseProxy(value: string, command?: string): ProxyOption {
  const v = value.trim();
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      return JSON.parse(v) as ProxyOption;
    } catch {
      throw new UsageError("--proxy is not valid JSON", command);
    }
  }
  const managed = /^(residential|datacenter)(?::([A-Za-z]{2}))?$/i.exec(v);
  if (managed) {
    const type = managed[1]!.toLowerCase() as "residential" | "datacenter";
    return managed[2] ? { type, country: managed[2].toUpperCase() } : type === "residential" ? { type, country: "US" } : { type };
  }
  if (/^https?:\/\//i.test(v)) {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      throw new UsageError(`--proxy "${redactUrl(v)}" is not a valid URL`, command);
    }
    if (!u.port) throw new UsageError("--proxy needs a port, e.g. http://host:8080", command);
    return {
      type: "custom",
      server: `${u.protocol}//${u.host}`,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    };
  }
  throw new UsageError("--proxy must be residential[:CC], datacenter[:CC], http://host:port or JSON", command);
}

/** A proxy URL without its password, for messages. */
const redactUrl = (s: string) => s.replace(/\/\/([^:/@]*):[^@/]*@/, "//$1:***@");

/** --var name=value (repeatable). */
export function parseVars(pairs: string[], command = "run"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    const name = eq === -1 ? p : p.slice(0, eq);
    if (eq === -1) throw new UsageError(`--var ${name}: write it as name=value`, command);
    if (!NAME.test(name)) throw new UsageError(`--var ${name}: names are letters, digits and _ (not starting with a digit)`, command);
    out[name] = p.slice(eq + 1);
  }
  return out;
}

/**
 * --secret NAME[@site[,site…]]: the value comes from the environment variable NAME (never from the command line,
 * where shell history and process lists would show it). With sites, it may be typed only into fields on them.
 */
export function parseSecrets(specs: string[], env: Record<string, string | undefined>, command = "run"): Record<string, AgentVariable> {
  const out: Record<string, AgentVariable> = {};
  for (const spec of specs) {
    if (spec.includes("=")) {
      throw new UsageError(`--secret takes the name of an environment variable, not a value: set ${spec.split("=")[0]} in the environment and pass --secret ${spec.split("=")[0]} (plain values: --var name=value)`, command);
    }
    const at = spec.indexOf("@");
    const name = at === -1 ? spec : spec.slice(0, at);
    if (!NAME.test(name)) throw new UsageError(`--secret ${name}: names are letters, digits and _ (not starting with a digit)`, command);
    const value = env[name];
    if (value === undefined || value === "") throw new UsageError(`--secret ${name}: the environment variable ${name} is not set`, command);
    const origins = at === -1 ? [] : spec.slice(at + 1).split(",").map((o) => o.trim()).filter(Boolean);
    if (at !== -1 && !origins.length) throw new UsageError(`--secret ${name}@…: name at least one site, e.g. ${name}@https://example.com`, command);
    for (const o of origins) {
      if (!/^https?:\/\/(\*\.)?[^/\s]+$/i.test(o)) throw new UsageError(`--secret ${name}: "${o}" is not a site like https://example.com (no path)`, command);
    }
    out[name] = origins.length ? { value, origins } : { value };
  }
  return out;
}

/** --env NAME=value (repeatable) for exec. */
export function parseEnv(pairs: string[], command = "exec"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq <= 0) throw new UsageError(`--env ${p}: write it as NAME=value`, command);
    out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return out;
}

const STATUSES: SessionStatus[] = ["RUNNING", "PAUSED", "COMPLETED", "ERROR"];

/** --status running,paused (any case). */
export function parseStatus(value: string | undefined, command = "sessions list"): SessionStatus[] | undefined {
  if (value === undefined) return undefined;
  const list = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const s of list) if (!STATUSES.includes(s as SessionStatus)) throw new UsageError(`--status ${s.toLowerCase()}: use running, paused, completed or error`, command);
  return list as SessionStatus[];
}

/** http(s) URLs only; a bare host gets https:// ("example.com" → "https://example.com"). */
export function normalizeUrl(value: string, command?: string): string {
  const v = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new UsageError(`"${value}" is not a URL`, command);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UsageError(`"${value}": only http and https pages`, command);
  return u.toString();
}

/** A file name from a page's host: "https://www.example.com/a" → "www.example.com.png". */
export function hostFileName(url: string, ext: string): string {
  let host = "page";
  try {
    host = new URL(url).hostname || "page";
  } catch {
    /* keep "page" */
  }
  return `${host.replace(/[^A-Za-z0-9.-]/g, "_")}.${ext}`;
}

/** A file name for a crawled page: "003-docs-getting-started.md". */
export function pageFileName(index: number, url: string, ext: string): string {
  let path = "";
  try {
    const u = new URL(url);
    path = `${u.hostname}${u.pathname}`;
  } catch {
    path = url;
  }
  const slug =
    path
      .replace(/\/+$/, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .toLowerCase() || "page";
  return `${String(index).padStart(3, "0")}-${slug}.${ext}`;
}

/** The last part of a workspace path ("downloads/report.csv" → "report.csv"). */
export function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}
