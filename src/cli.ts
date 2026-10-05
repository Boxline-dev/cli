/**
 * The boxline command line. `main(argv)` returns the exit code:
 * 0 done · 1 an error (API, network, a run that failed) · 2 a mistake in the command line · 130 stopped with Ctrl+C ·
 * `exec`: the command's own exit code (124 when it timed out).
 */
import { commandHelp } from "./args.js";
import * as account from "./commands/account.js";
import * as credentials from "./commands/credentials.js";
import * as files from "./commands/files.js";
import { continueRun, message, run } from "./commands/run.js";
import * as sessions from "./commands/sessions.js";
import { exec, shell } from "./commands/shell.js";
import * as tasks from "./commands/tasks.js";
import * as web from "./commands/web.js";
import { Ctx } from "./context.js";
import { colorEnabled, errorJson, errorLine, makeStyle, UsageError } from "./output.js";
import { route } from "./route.js";
import { SPECS } from "./spec.js";

type Handler = (ctx: Ctx) => Promise<number>;

const HANDLERS: Record<string, Handler> = {
  login: account.login,
  logout: account.logout,
  whoami: account.whoami,
  usage: account.usage,
  run,
  continue: continueRun,
  message,
  "tasks list": tasks.list,
  "tasks run": tasks.run,
  "credentials list": credentials.list,
  "credentials set": credentials.set,
  "credentials push-code": credentials.pushCode,
  "credentials delete": credentials.remove,
  search: web.searchCommand,
  fetch: web.fetchCommand,
  screenshot: web.screenshotCommand,
  pdf: web.pdfCommand,
  extract: web.extractCommand,
  crawl: web.crawlCommand,
  "sessions list": sessions.list,
  "sessions create": sessions.create,
  "sessions get": sessions.get,
  "sessions stop": sessions.stop,
  "sessions resume": sessions.resume,
  "sessions delete": sessions.remove,
  "sessions login": sessions.login,
  "sessions live": sessions.live,
  exec,
  shell,
  "files ls": files.ls,
  "files get": files.get,
  "files put": files.put,
  "files rm": files.rm,
};

export async function main(argv: string[]): Promise<number> {
  const wantsJson = argv.includes("--json");
  const errStyle = makeStyle(colorEnabled(process.stderr, process.env));
  const fail = (err: unknown, code: number) => {
    if (wantsJson) process.stdout.write(`${JSON.stringify(errorJson(err), null, 2)}\n`);
    else {
      process.stderr.write(`${errStyle.red(errorLine(err))}\n`);
      if (err instanceof UsageError) process.stderr.write(errStyle.dim(`Run "boxline ${err.command ? `${err.command} ` : ""}--help" for usage.\n`));
    }
    return code;
  };

  let r: ReturnType<typeof route>;
  try {
    r = route(argv);
  } catch (err) {
    return fail(err, 2);
  }
  if (r.kind === "help" || r.kind === "version") {
    process.stdout.write(r.text);
    return 0;
  }
  const handler = HANDLERS[r.name];
  if (!handler) return fail(new UsageError(`"${r.name}" is not available`), 2);

  const ctx = new Ctx(r.parsed);
  const onSigint = () => {
    if (!ctx.handleInterrupt()) {
      if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
      process.stderr.write("\n");
      process.exit(130);
    }
  };
  process.on("SIGINT", onSigint);
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof UsageError) return fail(err, 2);
    const exitCode = (err as { exitCode?: unknown }).exitCode;
    return fail(err, typeof exitCode === "number" ? exitCode : 1);
  } finally {
    process.off("SIGINT", onSigint);
  }
}

/** Every command's help, for the docs and the tests. */
export const allHelp = () => SPECS.map((s) => commandHelp(s));
