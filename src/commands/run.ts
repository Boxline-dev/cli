/**
 * boxline run "<task>": starts an agent run, shows its steps live, prints the answer, exits 0 only if it completed.
 * boxline continue <runId>: carries on a run that stopped at one of its limits, shown the same way.
 * boxline message <runId> "<text>": tells a working run something (it reads it at its next step).
 */
import { createInterface, type Interface } from "node:readline";
import type { AgentRun, AgentRunEvent, AgentRunParams, AgentRunStarted, Boxline, CaptchaMode, ContinueRunParams } from "@boxline/sdk";
import { arg, bool, list, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { UsageError } from "../output.js";
import { isStep, RunRenderer } from "../render.js";
import { parseSecrets, parseVars } from "../values.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * --steps N (1–1000) or --steps none / --no-step-limit (no step limit: the session's time bounds the run); --max-steps is
 * the older spelling of --steps N. Undefined: the API's default (30), or on continue the run's own.
 */
export function stepsOption(p: Ctx["parsed"], command: string): number | null | undefined {
  const steps = str(p, "steps");
  const legacy = num(p, "max-steps");
  const none = bool(p, "no-step-limit");
  if ([steps !== undefined, legacy !== undefined, none].filter(Boolean).length > 1) throw new UsageError("give the step limit once: --steps, --max-steps or --no-step-limit", command);
  if (none || steps === "none") return null;
  if (steps !== undefined) {
    const n = Number(steps);
    if (!/^\d+$/.test(steps) || n < 1 || n > 1000) throw new UsageError('--steps must be a whole number from 1 to 1000, or "none" for no step limit', command);
    return n;
  }
  return legacy;
}

/** --max-cost USD: the run's money budget (model cost), 0.01 to 100. */
export function costOption(p: Ctx["parsed"], command: string): number | undefined {
  const v = str(p, "max-cost");
  if (v === undefined) return undefined;
  const n = Number(v.replace(/^\$/, ""));
  if (!/^\$?\d+(\.\d+)?$/.test(v) || !(n >= 0.01 && n <= 100)) throw new UsageError("--max-cost must be US dollars from 0.01 to 100, e.g. 0.50", command);
  return n;
}

/** --var and --secret together (a name may be given once). */
function variablesOf(ctx: Pick<Ctx, "parsed" | "env">, command: string) {
  const p = ctx.parsed;
  const vars = parseVars(list(p, "var"), command);
  const secrets = parseSecrets(list(p, "secret"), ctx.env, command);
  for (const name of Object.keys(secrets)) if (name in vars) throw new UsageError(`${name} is given both as --var and as --secret`, command);
  return { ...vars, ...secrets };
}

/** --credential NAME (repeatable): saved credentials the run may use; the names only, never values. */
export function credentialNames(p: Ctx["parsed"], command: string): string[] {
  const names = list(p, "credential");
  for (const name of names) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) throw new UsageError(`--credential ${name}: credential names are capitals, digits and _ (see "boxline credentials list")`, command);
  }
  return [...new Set(names)];
}

/** The run's parameters from the command line (exported for the unit tests). */
export function runParams(ctx: Pick<Ctx, "parsed" | "env">): AgentRunParams {
  const p = ctx.parsed;
  const task = (arg(p, "task") ?? "").trim();
  if (!task) throw new UsageError("the task is empty", "run");
  const variables = variablesOf(ctx, "run");
  const credentials = credentialNames(p, "run");
  const sessionId = str(p, "session");
  const model = str(p, "model");
  const captcha = str(p, "captcha") as CaptchaMode | undefined;
  const maxSteps = stepsOption(p, "run");
  const maxCostUsd = costOption(p, "run");
  const timeout = num(p, "timeout");
  if (sessionId && timeout !== undefined) throw new UsageError("--timeout is for a new session; a session given with --session keeps its own time", "run");
  return {
    task,
    ...(sessionId ? { sessionId } : {}),
    ...(bool(p, "shell") ? { shell: true } : {}),
    ...(model ? { model } : {}),
    ...(captcha ? { captcha } : {}),
    ...(bool(p, "keep") ? { keepSession: true } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(Object.keys(variables).length ? { variables } : {}),
    ...(credentials.length ? { credentials } : {}),
  };
}

/** What `boxline continue` sends (exported for the unit tests). */
export function continueParams(ctx: Pick<Ctx, "parsed" | "env">): { runId: string; params: ContinueRunParams } {
  const p = ctx.parsed;
  const runId = (arg(p, "runId") ?? "").trim();
  if (!runId) throw new UsageError("which run? boxline continue <runId>", "continue");
  const maxSteps = stepsOption(p, "continue");
  const maxCostUsd = costOption(p, "continue");
  const note = str(p, "note")?.trim();
  // Values only: each variable keeps the sites and shell rule it had in the run being continued.
  const variables = Object.fromEntries(Object.entries(variablesOf(ctx, "continue")).map(([name, v]) => [name, typeof v === "string" ? v : { value: v.value }]));
  return {
    runId,
    params: {
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      ...(note ? { instruction: note } : {}),
      ...(Object.keys(variables).length ? { variables } : {}),
    },
  };
}

/**
 * What a line typed in the terminal does while a run streams (a terminal only, never with --json):
 * - while it works: the line goes to the agent as a message (agent.sendMessage), echoed as "you: …";
 * - while it asks for help: the line is the answer (a message, which resumes it); a bare Enter hands the browser back;
 * - while someone else has the browser (a takeover, a CAPTCHA): Enter hands it back, the line as the note.
 */
class RunInput {
  private rl: Interface | null = null;
  private paused: "agent" | "user" | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly bx: Boxline,
    private readonly runId: string,
    private readonly renderer: RunRenderer,
  ) {}

  open() {
    if (this.rl || !this.ctx.stdin.isTTY || this.ctx.json) return;
    this.ctx.info(this.ctx.err.dim("  Type a message and press Enter to tell the agent something while it works.\n"));
    // Not a raw terminal: the terminal echoes and edits the line itself, and Ctrl+C still stops the run.
    this.rl = createInterface({ input: this.ctx.stdin, terminal: false });
    this.rl.on("line", (line) => void this.onLine(line));
  }

  /** The run paused (who has the browser) or went on (null). */
  pause(by: "agent" | "user" | null) {
    if (by === this.paused) return;
    this.paused = by;
    if (!this.rl) return;
    if (by === "agent") {
      this.ctx.info(this.ctx.err.bold("  Type your answer and press Enter (or just Enter to hand the browser back).\n"));
      // What is typed here is kept in the run's steps: codes and passwords go into the page itself.
      this.ctx.info(this.ctx.err.dim("  Type passwords and verification codes in the live view, not here: what you type here is kept in the run's steps.\n"));
    }
    if (by === "user") this.ctx.info(this.ctx.err.bold("  Press Enter when you are done to hand the browser back (type a note first if you like).\n"));
  }

  private async onLine(line: string) {
    const text = line.trim();
    const fail = (err: Error) => this.ctx.info(this.ctx.err.red(`Could not send: ${err.message}\n`));
    if (this.paused === "user" || (this.paused === "agent" && !text)) {
      this.paused = null;
      await this.bx.agent.handBack(this.runId, text || undefined).catch(fail);
      return;
    }
    if (!text) return;
    try {
      const sent = await this.bx.agent.sendMessage(this.runId, text);
      this.renderer.sent.add(sent.id);
      this.ctx.stderr.write(this.renderer.youSaid(text));
    } catch (err) {
      fail(err as Error);
    }
  }

  close() {
    this.rl?.close();
    this.rl = null;
    this.ctx.stdin.pause();
  }
}

/** Streams a run until it ends, then prints its summary (stderr) and answer (stdout). Returns the exit code. */
async function watch(
  ctx: Ctx,
  bx: Boxline,
  started: AgentRunStarted,
  opts: { task: string; ownSession: boolean; keepSession?: boolean; shell?: boolean; continuedFrom?: string },
): Promise<number> {
  const renderer = new RunRenderer(started.sessionId, { style: ctx.err, columns: ctx.columns });
  ctx.info(renderer.header(started, { ownSession: opts.ownSession, continuedFrom: opts.continuedFrom }));
  const t0 = Date.now();

  ctx.onInterrupt(async () => {
    ctx.info(ctx.err.yellow("\nStopping the run… (Ctrl+C again quits at once)\n"));
    await bx.agent.cancel(started.id).catch(() => undefined);
  });

  const input = new RunInput(ctx, bx, started.id, renderer);
  input.open();
  const write = (text: string) => {
    if (text && !ctx.json) ctx.stderr.write(text);
  };
  let flushTimer: NodeJS.Timeout | undefined;
  let done: Extract<AgentRunEvent, { type: "done" }> | null = null;
  let lastExecAt: string | null = null;

  // The stream replays the run's steps first. If it drops (a proxy, a server restart), it is opened again and the
  // steps already shown are skipped.
  try {
    for (let attempt = 0; !done; attempt++) {
      let seen = 0;
      let skipOutput = false;
      try {
        for await (const e of bx.agent.stream(started.id)) {
          if (isStep(e) && seen++ < renderer.steps) continue;
          if (e.type === "exec") {
            // A reconnect replays the command that is running, and its output so far: shown already.
            if (attempt > 0 && e.at === lastExecAt) {
              skipOutput = true;
              continue;
            }
            lastExecAt = e.at;
          }
          if (e.type === "output" && skipOutput) {
            skipOutput = false;
            continue;
          }
          skipOutput = false;

          if (e.type === "handover" && (e.by === "agent" || e.by === "user")) {
            write(renderer.event(e));
            input.pause(e.by);
            continue;
          }
          if (e.type === "handback" || e.type === "done" || (e.type === "status" && e.status === "running")) input.pause(null);

          write(renderer.event(e));
          clearTimeout(flushTimer);
          // Thought text waits a moment: if the run ends with it, it is the answer and goes to stdout instead.
          if (renderer.hasPending) flushTimer = setTimeout(() => write(renderer.flush()), 800);
          if (e.type === "done") done = e;
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        // An answer from the API (not found, no access…) will not change by trying again.
        if ((typeof status === "number" && status > 0 && status < 500) || attempt >= 5) throw err;
      }
      if (!done) await sleep(Math.min(1000 * (attempt + 1), 5000));
    }
  } finally {
    clearTimeout(flushTimer);
    input.close();
    ctx.onInterrupt(null);
  }

  const final: AgentRun = await bx.agent.get(started.id).catch(() => ({
    id: started.id,
    status: done!.status,
    task: opts.task,
    sessionId: started.sessionId,
    provider: started.provider,
    model: started.model,
    keySource: started.keySource,
    mode: started.mode,
    steps: [],
    result: done!.result,
    resultText: done!.resultText,
    error: done!.error,
    errorCode: done!.errorCode,
    continuable: done!.continuable,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    handover: null,
    createdAt: new Date(t0).toISOString(),
    finishedAt: null,
  }));
  if (ctx.json) ctx.printJson(final);
  else {
    write(renderer.summary(final, Date.now() - t0));
    if (final.result) {
      write("\n");
      ctx.print(final.result.endsWith("\n") ? final.result : `${final.result}\n`);
    }
    if (opts.keepSession && opts.ownSession) {
      const id = started.sessionId;
      const shell = opts.shell ? ` · boxline shell ${id}` : "";
      write(ctx.err.dim(`\nThe session is still running: boxline sessions live ${id}${shell} · boxline sessions release ${id}\n`));
    }
  }
  if (final.status === "completed") return 0;
  return final.status === "canceled" ? 130 : 1;
}

export async function run(ctx: Ctx): Promise<number> {
  const params = runParams(ctx);
  if (params.sessionId && (params.shell || params.captcha || params.keepSession)) {
    ctx.info(ctx.err.yellow("Note: --shell, --captcha and --keep apply to a new session; with --session the session keeps its own settings.\n"));
  }
  const bx = ctx.client();
  const started = await bx.agent.run(params);
  return watch(ctx, bx, started, { task: params.task, ownSession: !params.sessionId, keepSession: params.keepSession, shell: params.shell });
}

/** boxline continue <runId>: a new run in the same session, streamed like `run`. */
export async function continueRun(ctx: Ctx): Promise<number> {
  const { runId, params } = continueParams(ctx);
  const bx = ctx.client();
  const next = await bx.agent.continueRun(runId, params);
  return watch(ctx, bx, { id: next.id, status: "running", sessionId: next.sessionId, provider: next.provider, model: next.model, keySource: next.keySource, mode: next.mode }, { task: next.task, ownSession: false, continuedFrom: runId });
}

/** boxline message <runId> "<text>": the agent reads it at its next step. */
export async function message(ctx: Ctx): Promise<number> {
  const p = ctx.parsed;
  const runId = (arg(p, "runId") ?? "").trim();
  const text = (arg(p, "text") ?? "").trim();
  if (!text) throw new UsageError("the message is empty", "message");
  const sent = await ctx.client().agent.sendMessage(runId, text);
  if (ctx.json) ctx.printJson(sent);
  else ctx.info(`Sent: the agent reads it at its next step (${sent.id}).\n`);
  return 0;
}
