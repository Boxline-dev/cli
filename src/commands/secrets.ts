/** secrets list | set | delete: project secrets (docs/CONTRACT.md "Project secrets"). Values are never printed. */
import { SecretExistsError, type Secret, type SecretScope } from "@boxline/sdk";
import { arg, bool, list as listOption, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, relativeTime, table, type Style, UsageError } from "../output.js";
import { readSecret, readStdin } from "../prompt.js";

/** The API's secret names: capitals, digits and _, not starting with a digit, 64 characters at most. */
const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** The table of `secrets list`: everything but the value, which the API never returns. */
export function secretsTable(list: Secret[], s: Style, now = Date.now()): string {
  return table(
    ["NAME", "SCOPE", "SHELL", "SITES", "PREVIEW", "LAST USED", "UPDATED"],
    list.map((x) => [
      x.name,
      x.scope,
      x.shell ? "yes" : "–",
      x.origins?.length ? x.origins.join(", ") : s.dim("any"),
      x.preview ?? "–",
      relativeTime(x.lastUsedAt, now),
      relativeTime(x.updatedAt, now),
    ]),
    s,
  );
}

/** Piped input is the value as it is, less one final line break (so `echo …` and files work, and keys of several lines). */
export const valueFromStdin = (text: string) => text.replace(/\r?\n$/, "");

/** The fields of `secrets set` other than the value: only those given, so a change leaves the rest as they are. */
export function secretFields(ctx: Pick<Ctx, "parsed">): { description?: string; origins?: string[]; shell?: boolean; scope?: SecretScope } {
  const p = ctx.parsed;
  const origins = listOption(p, "origin");
  for (const o of origins) {
    if (!/^https?:\/\/(\*\.)?[^/\s]+$/i.test(o)) throw new UsageError(`--origin "${o}" is not a site like https://example.com (no path)`, "secrets set");
  }
  const description = str(p, "description");
  const scope = str(p, "scope") as SecretScope | undefined;
  return {
    ...(description !== undefined ? { description } : {}),
    ...(origins.length ? { origins } : {}),
    ...(bool(p, "shell") ? { shell: true } : {}),
    ...(scope ? { scope } : {}),
  };
}

export async function list(ctx: Ctx): Promise<number> {
  const bx = ctx.client();
  const limit = num(ctx.parsed, "limit") ?? 100;
  let data: Secret[];
  let more = false;
  if (bool(ctx.parsed, "all")) {
    data = [];
    for await (const x of bx.secrets.list({ limit: 200 })) data.push(x);
  } else {
    const page = await bx.secrets.list({ limit });
    data = page.data;
    more = page.next !== null;
  }
  if (ctx.json) {
    ctx.printJson(data);
    return 0;
  }
  if (!data.length) {
    ctx.info('No secrets yet. Add one with "boxline secrets set NAME" (the value is asked for without showing it).\n');
    return 0;
  }
  ctx.print(secretsTable(data, ctx.out));
  if (more) ctx.info(ctx.err.dim(`Showing the first ${data.length}; --limit or --all for more.\n`));
  return 0;
}

export async function set(ctx: Ctx): Promise<number> {
  const command = "secrets set";
  const name = arg(ctx.parsed, "name")!;
  if (!NAME.test(name)) throw new UsageError(`${name}: secret names are capitals, digits and _ (not starting with a digit), 64 characters at most`, command);
  const fields = secretFields(ctx);
  const bx = ctx.client(); // before asking for the value, so a missing API key is said first
  if (ctx.stdin.isTTY) ctx.info(ctx.err.dim("Type or paste the value; it is not shown. Enter ends it.\n"));
  const value = ctx.stdin.isTTY ? await readSecret(`${name}: `, ctx.stdin, ctx.stderr) : valueFromStdin(await readStdin(ctx.stdin));
  if (!value) throw new CliError("no value given (type it at the prompt, or pipe it in)", "no_value");
  let secret: Secret;
  let created = true;
  try {
    secret = await bx.secrets.create({ name, value, ...fields });
  } catch (err) {
    if (!(err instanceof SecretExistsError)) throw err;
    created = false;
    secret = await bx.secrets.update(name, { value, ...fields });
  }
  if (ctx.json) {
    ctx.printJson(secret);
    return 0;
  }
  const where = secret.scope === "agent" ? "the AI only, as %NAME%" : secret.scope === "shell" ? "shells only, as $NAME" : "the AI and shells";
  ctx.info(`${ctx.err.green("✓")} ${created ? "Created" : "Updated"} ${ctx.err.bold(secret.name)} ${ctx.err.dim(`(scope ${secret.scope}: ${where.replace("NAME", secret.name)})`)}\n`);
  return 0;
}

export async function remove(ctx: Ctx): Promise<number> {
  const name = arg(ctx.parsed, "name")!;
  await ctx.client().secrets.delete(name);
  if (ctx.json) ctx.printJson({ ok: true, deleted: name });
  else ctx.info(`${ctx.err.green("✓")} Deleted ${name}\n`);
  return 0;
}
