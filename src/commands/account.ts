/** login, logout, whoami, usage. */
import { Boxline } from "@boxline/sdk";
import { str } from "../args.js";
import { checkApiUrl, configPath, DEFAULT_API_URL, removeConfig, tooOpen, writeConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { CliError, details, formatDate, formatDuration, formatUsd, UsageError } from "../output.js";
import { readSecret } from "../prompt.js";
import { VERSION } from "../version.js";

export async function login(ctx: Ctx): Promise<number> {
  const apiUrl = checkApiUrl(str(ctx.parsed, "api-url") ?? ctx.env.BOXLINE_API_URL?.trim() ?? DEFAULT_API_URL);
  if (ctx.stdin.isTTY) ctx.info(ctx.err.dim(`Paste an API key for ${apiUrl} (create one in the console under API keys).\n`));
  const key = await readSecret("API key: ", ctx.stdin, ctx.stderr);
  if (!key) throw new CliError("no API key given", "no_api_key");
  // Checked before it is saved, so a typo never ends up in the config file.
  const me = await new Boxline({ apiKey: key, baseUrl: apiUrl, maxRetries: 1, headers: { "user-agent": `boxline-cli/${VERSION}` } }).me();
  const file = writeConfig(apiUrl === DEFAULT_API_URL ? { apiKey: key } : { apiKey: key, apiUrl });
  if (ctx.json) {
    ctx.printJson({ ok: true, project: { id: me.project.id, name: me.project.name, plan: me.project.plan }, apiUrl, configPath: file });
    return 0;
  }
  ctx.info(`${ctx.err.green("✓")} Logged in to ${ctx.err.bold(me.project.name)} (${me.project.limits.name} plan) at ${apiUrl}.\n`);
  ctx.info(ctx.err.dim(`The key is saved in ${file} (only you can read it).\n`));
  if (ctx.env.BOXLINE_API_KEY) ctx.info(ctx.err.yellow("Note: BOXLINE_API_KEY is set in this shell, so it is used instead of the saved key.\n"));
  return 0;
}

export async function logout(ctx: Ctx): Promise<number> {
  const file = removeConfig(ctx.env);
  if (ctx.json) {
    ctx.printJson({ ok: true, removed: file });
    return 0;
  }
  ctx.info(file ? `Logged out: removed ${file}.\n` : "There was no saved key.\n");
  if (ctx.env.BOXLINE_API_KEY) ctx.info(ctx.err.yellow("Note: BOXLINE_API_KEY is still set in this shell.\n"));
  return 0;
}

export async function whoami(ctx: Ctx): Promise<number> {
  const bx = ctx.client();
  const me = await bx.me();
  const { apiUrl, source } = ctx.credentials;
  const keyFrom = source === "env" ? "BOXLINE_API_KEY" : configPath(ctx.env);
  if (ctx.json) {
    ctx.printJson({ user: me.user, project: { id: me.project.id, name: me.project.name, plan: me.project.plan, suspended: me.project.suspended }, apiUrl, keyFrom: source });
    return 0;
  }
  const s = ctx.out;
  ctx.print(
    details(
      [
        ["Project", `${s.bold(me.project.name)} ${s.dim(me.project.id)}`],
        ["Plan", `${me.project.limits.name} (up to ${me.project.limits.concurrency} sessions at once, ${Math.round(me.project.limits.maxTimeoutSeconds / 60)} min each)`],
        ["User", me.user ? me.user.email : s.dim("an API key (no user)")],
        ["Suspended", me.project.suspended ? s.red(`since ${formatDate(me.project.suspended.at)}${me.project.suspended.reason ? `: ${me.project.suspended.reason}` : ""}`) : undefined],
        ["API", apiUrl],
        ["Key", source === "env" ? keyFrom : `saved in ${keyFrom}`],
      ],
      s,
    ),
  );
  if (source === "config" && tooOpen(ctx.env)) ctx.info(ctx.err.yellow(`Warning: other users can read ${keyFrom}; run: chmod 600 "${keyFrom}"\n`));
  return 0;
}

const checkDate = (value: string | undefined, flag: string) => {
  if (value !== undefined && Number.isNaN(Date.parse(value))) throw new UsageError(`${flag} "${value}" is not a date (for example 2026-09-01)`, "usage");
  return value;
};

export async function usage(ctx: Ctx): Promise<number> {
  const from = checkDate(str(ctx.parsed, "from"), "--from");
  const to = checkDate(str(ctx.parsed, "to"), "--to");
  const u = await ctx.client().usage({ from, to });
  if (ctx.json) {
    ctx.printJson(u);
    return 0;
  }
  const s = ctx.out;
  const hours = (n: number) => (n / 3600).toFixed(2);
  const proxyGb = u.proxy.residentialGb + u.proxy.datacenterGb + u.proxy.customGb;
  ctx.print(
    details(
      [
        ["Period", `${formatDate(u.from)} to ${formatDate(u.to)}`],
        ["Sessions", `${u.sessions}${u.running ? ` (${u.running} running now)` : ""}`],
        ["Browser time", formatDuration(u.browserSeconds * 1000)],
        ["Shell machines", `${hours(u.sandboxVcpuSeconds)} vCPU-hours · ${hours(u.sandboxGibSeconds)} GiB-hours`],
        ["Proxy data", `${proxyGb.toFixed(3)} GB (${formatUsd(u.proxy.costUsd)})`],
        [
          "CAPTCHA solving",
          u.captchaSolves.solved + u.captchaSolves.failed + u.captchaSolves.refused
            ? `${u.captchaSolves.solved} solved, ${u.captchaSolves.failed} failed, ${u.captchaSolves.refused} refused (${formatUsd(u.captchaSolves.costUsd)})`
            : "none",
        ],
        ["Cost", s.bold(formatUsd(u.costUsd))],
      ],
      s,
    ),
  );
  return 0;
}
