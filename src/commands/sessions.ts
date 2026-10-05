/** sessions list | create | get | stop | resume | delete | login | live */
import { CredentialCodeTimeoutError, CredentialLinkWrongSiteError, CredentialLoginFailedError, type CaptchaMode, type CreateSessionParams, type SessionData } from "@boxline/sdk";
import { arg, bool, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, details, formatDate, formatDuration, formatUsd, relativeTime, table, type Style, UsageError } from "../output.js";
import { parseProxy, parseStatus } from "../values.js";

export const kindOf = (s: Pick<SessionData, "browser" | "shell">) => (s.browser && s.shell ? "browser+shell" : s.shell ? "shell" : "browser");

export function statusText(status: SessionData["status"], s: Style): string {
  const word = status.toLowerCase();
  if (status === "RUNNING") return s.green(word);
  if (status === "STOPPED") return s.yellow(word);
  if (status === "ERROR") return s.red(word);
  return s.dim(word);
}

/** A proxy in one short phrase ("residential US", "custom http://host:8080", "3 rules"). */
export function proxyText(proxy: SessionData["proxy"]): string {
  if (!proxy) return "none";
  if (Array.isArray(proxy)) return `${proxy.length} rules`;
  if (proxy.type === "custom") return `custom ${proxy.server}`;
  return [proxy.type, proxy.country].filter(Boolean).join(" ");
}

/** The sessions table of `sessions list`. */
export function sessionsTable(list: SessionData[], s: Style, now = Date.now()): string {
  return table(
    ["ID", "STATUS", "KIND", "CREATED", "DURATION", "COST"],
    list.map((x) => [x.id, statusText(x.status, s), kindOf(x), relativeTime(x.createdAt, now), formatDuration(x.usage.seconds * 1000), formatUsd(x.usage.costUsd)]),
    s,
  );
}

/** What `sessions get` and `sessions create` show. The signed URLs are left out: `sessions live` prints them. */
export function sessionDetails(x: SessionData, s: Style, now = Date.now()): string {
  const running = x.status === "RUNNING";
  return details(
    [
      ["ID", s.bold(x.id)],
      ["Status", statusText(x.status, s) + (x.status === "STOPPED" && x.stopReason ? s.dim(` (${x.stopReason.replace(/_/g, " ")})`) : "")],
      ["Machine", kindOf(x).replace("+", " + ")],
      ["Created", `${formatDate(x.createdAt)} ${s.dim(`(${relativeTime(x.createdAt, now)})`)}`],
      ["Expires", running ? `${formatDate(x.expiresAt)} ${s.dim(`(${relativeTime(x.expiresAt, now)})`)}` : undefined],
      ["Stopped", x.stoppedAt ? formatDate(x.stoppedAt) : undefined],
      ["Deleted on", x.deletesAt ? `${formatDate(x.deletesAt)} ${s.dim(`(${relativeTime(x.deletesAt, now)})`)}` : x.deletedAt ? formatDate(x.deletedAt) : undefined],
      ["Proxy", x.proxy ? proxyText(x.proxy) : undefined],
      ["CAPTCHA", x.attention ? s.yellow(`${x.attention.kind} waiting on ${x.attention.url}`) : x.captcha],
      ["Workspace", x.shell ? x.workspacePath : undefined],
      ["Usage", `${formatDuration(x.usage.seconds * 1000)} · ${formatUsd(x.usage.costUsd)}`],
      ["Error", x.error ? s.red(x.error) : undefined],
    ],
    s,
  );
}

export async function list(ctx: Ctx): Promise<number> {
  const bx = ctx.client();
  const status = parseStatus(str(ctx.parsed, "status"));
  const limit = num(ctx.parsed, "limit") ?? 20;
  let data: SessionData[];
  let more = false;
  if (bool(ctx.parsed, "all")) {
    data = [];
    for await (const s of bx.sessions.list({ status, limit: 200 })) data.push(s.data);
  } else {
    const page = await bx.sessions.list({ status, limit });
    data = page.data.map((s) => s.data);
    more = page.next !== null;
  }
  if (ctx.json) {
    ctx.printJson(data);
    return 0;
  }
  if (!data.length) {
    ctx.info(status ? "No sessions with that status.\n" : 'No sessions yet. Start one with "boxline sessions create".\n');
    return 0;
  }
  ctx.print(sessionsTable(data, ctx.out));
  if (more) ctx.info(ctx.err.dim(`Showing the newest ${data.length}; --limit or --all for more.\n`));
  return 0;
}

export async function create(ctx: Ctx): Promise<number> {
  const p = ctx.parsed;
  const shell = bool(p, "shell");
  const noBrowser = bool(p, "no-browser");
  if (noBrowser && !shell) throw new UsageError("--no-browser needs --shell (a session has a browser, a shell or both)", "sessions create");
  const params: CreateSessionParams = {
    ...(shell ? { shell: true } : {}),
    ...(noBrowser ? { browser: false } : {}),
    ...(str(p, "proxy") !== undefined ? { proxy: parseProxy(str(p, "proxy")!, "sessions create") } : {}),
    ...(num(p, "timeout") !== undefined ? { timeout: num(p, "timeout") } : {}),
    ...(num(p, "idle-timeout") !== undefined ? { idleTimeout: num(p, "idle-timeout") } : {}),
    ...(str(p, "captcha") ? { captcha: str(p, "captcha") as CaptchaMode } : {}),
    ...(bool(p, "keep-alive") ? { keepAlive: true } : {}),
  };
  const session = await ctx.client().sessions.create(params);
  if (ctx.json) {
    ctx.printJson(session.data);
    return 0;
  }
  const id = session.id;
  ctx.print(sessionDetails(session.data, ctx.out));
  const hints = [
    session.data.browser ? `Watch it:  boxline sessions live ${id}` : null,
    session.data.shell ? `Terminal:  boxline shell ${id}` : null,
    session.data.shell ? `Run:       boxline exec ${id} -- ls` : null,
    `Stop it:   boxline sessions stop ${id}`,
  ].filter(Boolean);
  ctx.info(ctx.err.dim(hints.join("\n") + "\n"));
  return 0;
}

export async function get(ctx: Ctx): Promise<number> {
  const session = await ctx.client().sessions.get(arg(ctx.parsed, "id")!);
  if (ctx.json) ctx.printJson(session.data);
  else ctx.print(sessionDetails(session.data, ctx.out));
  return 0;
}

export async function stop(ctx: Ctx): Promise<number> {
  const session = await ctx.client().sessions.stop(arg(ctx.parsed, "id")!);
  if (ctx.json) {
    ctx.printJson(session.data);
    return 0;
  }
  const x = session.data;
  const keep = x.deletesAt ? `kept until ${formatDate(x.deletesAt)}; "boxline sessions resume ${x.id}" brings it back` : "";
  ctx.info(`${ctx.err.green("✓")} Stopped ${x.id} ${ctx.err.dim(`(ran ${formatDuration(x.usage.seconds * 1000)}, ${formatUsd(x.usage.costUsd)}${keep ? `; ${keep}` : ""})`)}\n`);
  return 0;
}

export async function resume(ctx: Ctx): Promise<number> {
  const session = await ctx.client().sessions.resume(arg(ctx.parsed, "id")!);
  if (ctx.json) {
    ctx.printJson(session.data);
    return 0;
  }
  ctx.print(sessionDetails(session.data, ctx.out));
  ctx.info(ctx.err.dim(`Watch it:  boxline sessions live ${session.id}\n`));
  return 0;
}

/** `sessions delete`: ends the session for good, with what it saved, its recording and its logs. */
export async function remove(ctx: Ctx): Promise<number> {
  const session = await ctx.client().sessions.delete(arg(ctx.parsed, "id")!);
  if (ctx.json) {
    ctx.printJson(session.data);
    return 0;
  }
  const x = session.data;
  ctx.info(`${ctx.err.green("✓")} Deleted ${x.id} ${ctx.err.dim(`(ran ${formatDuration(x.usage.seconds * 1000)}, ${formatUsd(x.usage.costUsd)})`)}\n`);
  return 0;
}

export async function live(ctx: Ctx): Promise<number> {
  const urls = await ctx.client().sessions.live(arg(ctx.parsed, "id")!);
  if (ctx.json) {
    ctx.printJson(urls);
    return 0;
  }
  if (!urls.liveUrl) throw new CliError("this session has no live view: it has no browser, or it is not running", "no_live_view");
  ctx.print(`${urls.liveUrl}\n`);
  ctx.info(ctx.err.dim("Open it in a browser. Treat it like a password: anyone with the link can watch and control the session.\n"));
  return 0;
}

/**
 * sessions login ID CREDENTIAL: signs the session's browser in with a password credential (a short AI run on the
 * credential's sites; a code source of push or url waits for its code or link). The model never sees a value.
 */
export async function login(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  const credential = arg(ctx.parsed, "credential")!;
  const url = str(ctx.parsed, "url");
  if (url !== undefined && !/^https?:\/\/[^\s/]+/i.test(url)) throw new UsageError(`--url "${url}" is not an address like https://example.com/login`, "sessions login");
  const bx = ctx.client();
  const session = await bx.sessions.get(id);
  ctx.info(ctx.err.dim(`Signing in with ${credential}…\n`));
  try {
    const page = await session.login(credential, url !== undefined ? { url } : {});
    if (ctx.json) {
      ctx.printJson(page);
      return 0;
    }
    ctx.info(`${ctx.err.green("✓")} Signed in with ${ctx.err.bold(credential)} ${ctx.err.dim(`(${page.title || "no title"}, ${page.url}; run ${page.runId})`)}\n`);
    return 0;
  } catch (err) {
    // Say which run tried, and what to do about a code that did not come.
    if (err instanceof CredentialLoginFailedError) throw new CliError(`${err.message}${err.runId ? ` (run ${err.runId}; watch the session with "boxline sessions live ${id}")` : ""}`, err.code);
    if (err instanceof CredentialCodeTimeoutError) throw new CliError(`${err.message} (send the code or link with "boxline credentials push-code ${credential}" while it waits)`, err.code);
    if (err instanceof CredentialLinkWrongSiteError) throw new CliError(err.message, err.code);
    throw err;
  }
}
