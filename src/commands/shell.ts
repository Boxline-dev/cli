/** exec (one command, streamed) and shell (an interactive terminal over the session's terminal WebSocket). */
import type { ExecExit, ExecOptions } from "@boxline/sdk";
import WebSocket from "ws";
import { arg, list, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, LineGuard, oneLine } from "../output.js";
import { parseEnv } from "../values.js";
import { VERSION } from "../version.js";

/** The CLI's exit code for a command: its own, 124 when it timed out (like timeout(1)), 1 when unknown. */
export const exitCodeOf = (e: Pick<ExecExit, "exitCode" | "timedOut">) => (e.timedOut ? 124 : (e.exitCode ?? 1));

export async function exec(ctx: Ctx): Promise<number> {
  const p = ctx.parsed;
  const id = arg(p, "id")!;
  // Joined with spaces and run by bash, like ssh: `-- 'a | b'` keeps a pipeline together.
  const command = p.rest.join(" ");
  const timeout = num(p, "timeout");
  const opts: ExecOptions = {
    ...(str(p, "cwd") ? { cwd: str(p, "cwd") } : {}),
    ...(list(p, "env").length ? { env: parseEnv(list(p, "env")) } : {}),
    ...(timeout ? { timeoutMs: timeout * 1000 } : {}),
  };
  const bx = ctx.client();
  if (ctx.json) {
    const r = await bx.sessions.exec(id, command, opts);
    ctx.printJson(r);
    return exitCodeOf(r);
  }
  const abort = new AbortController();
  ctx.onInterrupt(() => abort.abort());
  // Both on one terminal: keep their lines apart. Otherwise every byte goes through unchanged.
  const guard = ctx.stdout.isTTY && ctx.stderr.isTTY ? new LineGuard() : null;
  const onData = (stream: "stdout" | "stderr", data: string) => (stream === "stdout" ? ctx.stdout : ctx.stderr).write(guard ? guard.next(stream, data) : data);
  let exit: ExecExit;
  try {
    exit = await bx.sessions.execStream(id, command, onData, { ...opts, signal: abort.signal });
  } catch (err) {
    if (abort.signal.aborted) {
      ctx.info("\nStopped.\n");
      return 130;
    }
    throw err;
  }
  if (exit.timedOut) ctx.info(ctx.err.yellow(`\nThe command did not finish within ${timeout ?? 120} s and was stopped.\n`));
  if (exit.truncated) ctx.info(ctx.err.dim("\nThe output was too long and was cut.\n"));
  return exitCodeOf(exit);
}

const CTRL_RIGHT_BRACKET = "\u001d";
const EOT = "\u0004";

export async function shell(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  // Fresh signed URLs: the terminal URL is a bearer credential, used here and never printed.
  const urls = await ctx.client().sessions.live(id);
  if (!urls.terminalUrl) throw new CliError('this session has no shell (start one with "boxline sessions create --shell")', "no_shell");
  const { stdin, stdout } = ctx;
  const interactive = Boolean(stdin.isTTY);

  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(urls.terminalUrl!, { handshakeTimeout: 30_000, headers: { "user-agent": `boxline-cli/${VERSION}` } });
    let opened = false;
    let settled = false;
    let leftByUser = false;
    const send = (msg: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    const onResize = () => send({ type: "resize", cols: stdout.columns, rows: stdout.rows });
    const onInput = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (interactive && text.includes(CTRL_RIGHT_BRACKET)) {
        leftByUser = true;
        ws.close(1000, "left");
        return;
      }
      send({ type: "input", data: text });
    };
    // Piped input: when it ends, end the shell like Ctrl+D would.
    const onEnd = () => send({ type: "input", data: EOT });
    const cleanup = () => {
      stdin.off("data", onInput);
      stdin.off("end", onEnd);
      stdout.off("resize", onResize);
      if (interactive && stdin.isRaw) stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = (code: number, err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(code);
    };

    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf8")));
      const refused = () => {
        finish(1, new CliError(`the terminal refused the connection (${res.statusCode}${body ? `: ${oneLine(body, 200)}` : ""})`, "terminal_refused"));
        ws.terminate(); // its late error and close events find the promise settled
      };
      res.on("end", refused);
      res.on("error", refused);
    });
    ws.on("open", () => {
      opened = true;
      if (interactive) {
        ctx.info(ctx.err.dim(`Connected to ${id}. Ctrl+D leaves, Ctrl+] disconnects at once.\r\n`));
        stdin.setRawMode(true);
        if (stdout.isTTY) {
          onResize();
          stdout.on("resize", onResize);
        }
      } else stdin.on("end", onEnd);
      stdin.on("data", onInput);
      stdin.resume();
    });
    ws.on("message", (data, isBinary) => {
      stdout.write(isBinary ? (data as Buffer) : data.toString());
    });
    ws.on("close", (code) => {
      if (!opened) return finish(1, new CliError("the terminal connection closed before it opened", "terminal_closed"));
      if (interactive) ctx.info(ctx.err.dim(`\r\n${leftByUser ? "Disconnected" : "Shell closed"}; the session keeps running.\r\n`));
      // 1000: the shell exited (Ctrl+D, exit) or we left; anything else means the connection broke.
      if (code === 1000 || code === 1005 || leftByUser) finish(0);
      else finish(1, new CliError(`the terminal connection was lost (code ${code})`, "terminal_lost"));
    });
    ws.on("error", (err) => {
      if (!settled && ws.readyState !== WebSocket.CLOSED) ws.terminate();
      finish(1, new CliError(`could not connect to the terminal: ${err.message}`, "terminal_error"));
    });
  });
}
