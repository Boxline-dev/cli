/** tasks list | run: saved tasks (docs/CONTRACT.md "Tasks"). */
import type { Task, TaskRun } from "@boxline/sdk";
import { arg, bool, list as listOption, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { formatCount, formatDuration, formatUsd, json, oneLine, relativeTime, table, type Style, UsageError } from "../output.js";
import { parseSecrets, parseVars } from "../values.js";

/** When a task runs, in one short phrase: "0 9 * * MON-FRI Europe/London", the same with "(off)", or "–". */
export function scheduleText(schedule: Task["schedule"], s: Style): string {
  if (!schedule) return "–";
  const when = `${schedule.cron} ${schedule.timezone}`;
  return schedule.enabled ? when : s.dim(`${when} (off)`);
}

/** The table of `tasks list`. */
export function tasksTable(list: Task[], s: Style, now = Date.now()): string {
  return table(
    ["ID", "NAME", "SCHEDULE", "LAST RUN", "CREATED"],
    list.map((t) => [t.id, oneLine(t.name, 40), scheduleText(t.schedule, s), relativeTime(t.lastRunAt, now), relativeTime(t.createdAt, now)]),
    s,
  );
}

/**
 * The run's values from --var name=value and --secret NAME (the value of the environment variable NAME, never from
 * the command line). Where a secret may be typed is the task's own setting, so --secret takes no @site here.
 */
export function taskRunVariables(ctx: Pick<Ctx, "parsed" | "env">): Record<string, string> {
  const command = "tasks run";
  const vars = parseVars(listOption(ctx.parsed, "var"), command);
  const out: Record<string, string> = { ...vars };
  for (const [name, v] of Object.entries(parseSecrets(listOption(ctx.parsed, "secret"), ctx.env, command))) {
    if (typeof v !== "string" && v.origins) throw new UsageError(`--secret ${name}@…: the task says where %${name}% may be typed; pass --secret ${name}`, command);
    if (name in vars) throw new UsageError(`${name} is given both as --var and as --secret`, command);
    out[name] = typeof v === "string" ? v : v.value;
  }
  return out;
}

/** The last line people see: how the run ended, how long it took, tokens and cost. */
export function taskRunSummary(run: TaskRun, s: Style, elapsedMs: number): string {
  const tokens = run.usage.inputTokens + run.usage.outputTokens;
  const parts = [formatDuration(run.durationMs ?? elapsedMs), `${formatCount(tokens)} tokens`];
  if (run.usage.costUsd !== null) parts.push(formatUsd(run.usage.costUsd));
  const facts = s.dim(` in ${parts.join(" · ")}`);
  if (run.status === "completed") return `${s.green("✓ completed")}${facts}\n`;
  if (run.status === "canceled") return `${s.yellow("■ stopped")}${facts}\n`;
  const why = [run.error, run.errorCode ? s.dim(`(${run.errorCode})`) : ""].filter(Boolean).join(" ");
  return `${s.red(`✗ ${run.status}`)}${facts}${why ? `: ${why}` : ""}\n`;
}

/** What `tasks run` prints on stdout: the JSON answer (a task with an output schema), else the final text. */
export function taskRunOutput(run: TaskRun): string {
  if (run.result === null || run.result === undefined) return "";
  if (!run.structured && typeof run.result === "string") return run.result.endsWith("\n") ? run.result : `${run.result}\n`;
  return json(run.result);
}

export async function list(ctx: Ctx): Promise<number> {
  const bx = ctx.client();
  const limit = num(ctx.parsed, "limit") ?? 20;
  let data: Task[];
  let more = false;
  if (bool(ctx.parsed, "all")) {
    data = [];
    for await (const t of bx.tasks.list({ limit: 200 })) data.push(t);
  } else {
    const page = await bx.tasks.list({ limit });
    data = page.data;
    more = page.next !== null;
  }
  if (ctx.json) {
    ctx.printJson(data);
    return 0;
  }
  if (!data.length) {
    ctx.info("No tasks yet. Save one in the console (Tasks) or with the SDK (bx.tasks.create).\n");
    return 0;
  }
  ctx.print(tasksTable(data, ctx.out));
  if (more) ctx.info(ctx.err.dim(`Showing the newest ${data.length}; --limit or --all for more.\n`));
  return 0;
}

export async function run(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  const variables = taskRunVariables(ctx);
  const sessionId = str(ctx.parsed, "session");
  const bx = ctx.client();
  const t0 = Date.now();
  const started = await bx.tasks.run(id, { ...(Object.keys(variables).length ? { variables } : {}), ...(sessionId ? { sessionId } : {}) });
  ctx.info(`Task run ${ctx.err.bold(started.id)} · agent run ${started.runId ?? "–"} · session ${started.sessionId ?? "–"}\n`);
  ctx.info(ctx.err.dim("Waiting for it to finish. Ctrl+C stops the run.\n"));
  ctx.onInterrupt(async () => {
    ctx.info(ctx.err.yellow("\nStopping the run… (Ctrl+C again quits at once)\n"));
    if (started.runId) await bx.agent.cancel(started.runId).catch(() => undefined);
  });
  const done = await bx.tasks.waitForRun(started, { pollMs: 2000, timeoutMs: 6 * 60 * 60_000 });
  ctx.onInterrupt(null);
  if (ctx.json) ctx.printJson(done);
  else {
    ctx.info(taskRunSummary(done, ctx.err, Date.now() - t0));
    ctx.print(taskRunOutput(done));
  }
  if (done.status === "completed") return 0;
  return done.status === "canceled" ? 130 : 1;
}
