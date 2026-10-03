/**
 * credentials list | set | delete: website passwords and secrets (docs/CONTRACT.md "Credentials"). Values are never
 * printed, and never taken from a command-line argument (shell history and process lists would show them): a secret's
 * value, a password and a 2FA setup key come from a hidden prompt or from stdin.
 */
import {
  CredentialExistsError,
  NotFoundError,
  type Boxline,
  type Credential,
  type CredentialScope,
  type CredentialType,
  type PasswordCredentialUpdateParams,
  type SecretCredentialUpdateParams,
} from "@boxline/sdk";
import { arg, bool, list as listOption, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, relativeTime, table, type Style, UsageError } from "../output.js";
import { readSecret, readStdin } from "../prompt.js";

/** The API's credential names: capitals, digits and _, not starting with a digit, 64 characters at most. */
const NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** What `credentials list` shows of one credential besides its sites: a password's user name and 2FA, a secret's preview. */
function detail(x: Credential): string {
  if (x.type === "password") return `${x.username}${x.hasTotp ? ", 2FA" : ""}`;
  return x.preview ?? "–";
}

/** The table of `credentials list`: everything but the values, which the API never returns. */
export function credentialsTable(list: Credential[], s: Style, now = Date.now()): string {
  return table(
    ["NAME", "TYPE", "SCOPE", "SHELL", "SITES", "DETAIL", "LAST USED", "UPDATED"],
    list.map((x) => [
      x.name,
      x.type,
      x.scope,
      x.shell ? "yes" : "–",
      x.origins?.length ? x.origins.join(", ") : s.dim("any"),
      detail(x),
      relativeTime(x.lastUsedAt, now),
      relativeTime(x.updatedAt, now),
    ]),
    s,
  );
}

/** Piped input is the value as it is, less one final line break (so `echo …` and files work, and keys of several lines). */
export const valueFromStdin = (text: string) => text.replace(/\r?\n$/, "");

/** A password piped in: the first line is the password, with --2fa the second is the 2FA setup key; nothing else. */
export function passwordFromStdin(text: string, withTotp: boolean): { password: string; totpSecret?: string } {
  const lines = valueFromStdin(text).split(/\r?\n/);
  const max = withTotp ? 2 : 1;
  if (lines.length > max) {
    throw new CliError(
      withTotp ? "piped input is the password on the first line and the 2FA setup key on the second, nothing more" : "piped input is the password on its first line, nothing more (add --2fa to give a 2FA setup key on the second line)",
      "bad_input",
    );
  }
  return { password: lines[0] ?? "", ...(withTotp ? { totpSecret: (lines[1] ?? "").trim() } : {}) };
}

/** The fields of `credentials set` other than the values: only those given, so a change leaves the rest as they are. */
export function credentialFields(ctx: Pick<Ctx, "parsed">): { description?: string; origins?: string[]; shell?: boolean; scope?: CredentialScope } {
  const p = ctx.parsed;
  const origins = listOption(p, "origin");
  for (const o of origins) {
    if (!/^https?:\/\/(\*\.)?[^/\s]+$/i.test(o)) throw new UsageError(`--origin "${o}" is not a site like https://example.com (no path)`, "credentials set");
  }
  const description = str(p, "description");
  const scope = str(p, "scope") as CredentialScope | undefined;
  return {
    ...(description !== undefined ? { description } : {}),
    ...(origins.length ? { origins } : {}),
    ...(bool(p, "shell") ? { shell: true } : {}),
    ...(scope ? { scope } : {}),
  };
}

/**
 * The type `credentials set` works with: --type, else the type of the credential that exists, else a password when a
 * password-only option is given (--username, --2fa, --remove-2fa), else a secret.
 */
export function credentialType(ctx: Pick<Ctx, "parsed">, existing: Credential | null): CredentialType {
  const p = ctx.parsed;
  const given = str(p, "type") as CredentialType | undefined;
  const passwordOptions = [str(p, "username") !== undefined, bool(p, "2fa"), bool(p, "remove-2fa")];
  const type = given ?? existing?.type ?? (passwordOptions.some(Boolean) ? "password" : "secret");
  if (existing && existing.type !== type) {
    throw new CliError(`${existing.name} is a ${existing.type} credential; delete it first to make it a ${type}`, "wrong_type");
  }
  if (type === "secret" && passwordOptions.some(Boolean)) throw new UsageError("--username, --2fa and --remove-2fa are for passwords (--type password)", "credentials set");
  return type;
}

/** How a credential may be used, in words. */
function where(c: Credential): string {
  const names = c.type === "password" ? { ai: `%${c.name}.username% and %${c.name}.password%`, sh: `$${c.name}_USERNAME and $${c.name}_PASSWORD` } : { ai: `%${c.name}%`, sh: `$${c.name}` };
  return c.scope === "agent" ? `the AI only, as ${names.ai}` : c.scope === "shell" ? `shells only, as ${names.sh}` : "the AI and shells";
}

export async function list(ctx: Ctx): Promise<number> {
  const bx = ctx.client();
  const limit = num(ctx.parsed, "limit") ?? 100;
  let data: Credential[];
  let more = false;
  if (bool(ctx.parsed, "all")) {
    data = [];
    for await (const x of bx.credentials.list({ limit: 200 })) data.push(x);
  } else {
    const page = await bx.credentials.list({ limit });
    data = page.data;
    more = page.next !== null;
  }
  if (ctx.json) {
    ctx.printJson(data);
    return 0;
  }
  if (!data.length) {
    ctx.info('No credentials yet. Add one with "boxline credentials set NAME" (the value is asked for without showing it).\n');
    return 0;
  }
  ctx.print(credentialsTable(data, ctx.out));
  if (more) ctx.info(ctx.err.dim(`Showing the first ${data.length}; --limit or --all for more.\n`));
  return 0;
}

async function find(bx: Boxline, name: string): Promise<Credential | null> {
  try {
    return await bx.credentials.get(name);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** The sensitive values, from the hidden prompt (a terminal) or from stdin: never from the command line. */
async function readValues(ctx: Ctx, name: string, type: CredentialType, withTotp: boolean): Promise<{ value?: string; password?: string; totpSecret?: string }> {
  const tty = ctx.stdin.isTTY;
  if (type === "secret") {
    if (tty) ctx.info(ctx.err.dim("Type or paste the value; it is not shown. Enter ends it.\n"));
    const value = tty ? await readSecret(`${name}: `, ctx.stdin, ctx.stderr) : valueFromStdin(await readStdin(ctx.stdin));
    if (!value) throw new CliError("no value given (type it at the prompt, or pipe it in)", "no_value");
    return { value };
  }
  let password: string;
  let totpSecret: string | undefined;
  if (tty) {
    ctx.info(ctx.err.dim("Type or paste each value; it is not shown. Enter ends it.\n"));
    password = await readSecret(`${name} password: `, ctx.stdin, ctx.stderr);
    if (withTotp) totpSecret = await readSecret(`${name} 2FA setup key: `, ctx.stdin, ctx.stderr);
  } else ({ password, totpSecret } = passwordFromStdin(await readStdin(ctx.stdin), withTotp));
  if (!password) throw new CliError("no password given (type it at the prompt, or pipe it in)", "no_value");
  if (withTotp && !totpSecret) throw new CliError("no 2FA setup key given (it is the second line of piped input, or the second prompt)", "no_value");
  return { password, ...(withTotp ? { totpSecret } : {}) };
}

export async function set(ctx: Ctx): Promise<number> {
  const command = "credentials set";
  const p = ctx.parsed;
  const name = arg(p, "name")!;
  if (!NAME.test(name)) throw new UsageError(`${name}: credential names are capitals, digits and _ (not starting with a digit), 64 characters at most`, command);
  const fields = credentialFields(ctx);
  const username = str(p, "username");
  const withTotp = bool(p, "2fa");
  const removeTotp = bool(p, "remove-2fa");
  if (withTotp && removeTotp) throw new UsageError("give --2fa (a new 2FA setup key) or --remove-2fa, not both", command);
  const bx = ctx.client(); // before asking for values, so a missing API key is said first
  const existing = await find(bx, name);
  const type = credentialType(ctx, existing);
  if (type === "password" && !existing) {
    if (!username) throw new UsageError("a password needs --username", command);
    if (!fields.origins) throw new UsageError("a password needs at least one --origin (the site the AI may type it on), e.g. --origin https://example.com", command);
  }
  const values = await readValues(ctx, name, type, withTotp);

  let credential: Credential;
  let created = !existing;
  const create = () =>
    type === "password"
      ? bx.credentials.create({ name, type, origins: fields.origins!, username: username!, password: values.password!, ...(values.totpSecret ? { totpSecret: values.totpSecret } : {}), ...omit(fields, "origins") })
      : bx.credentials.create({ name, type, value: values.value!, ...fields });
  const update = () =>
    type === "password"
      ? bx.credentials.update(name, {
          password: values.password!,
          ...(username !== undefined ? { username } : {}),
          ...(withTotp ? { totpSecret: values.totpSecret! } : removeTotp ? { totpSecret: null } : {}),
          ...fields,
        } satisfies PasswordCredentialUpdateParams)
      : bx.credentials.update(name, { value: values.value!, ...fields } satisfies SecretCredentialUpdateParams);
  if (existing) credential = await update();
  else {
    try {
      credential = await create();
    } catch (err) {
      if (!(err instanceof CredentialExistsError)) throw err;
      created = false; // made by someone else since the lookup: change it instead
      credential = await update();
    }
  }
  if (ctx.json) {
    ctx.printJson(credential);
    return 0;
  }
  ctx.info(`${ctx.err.green("✓")} ${created ? "Created" : "Updated"} ${ctx.err.bold(credential.name)} ${ctx.err.dim(`(${credential.type}, scope ${credential.scope}: ${where(credential)})`)}\n`);
  return 0;
}

function omit<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = o;
  return rest;
}

export async function remove(ctx: Ctx): Promise<number> {
  const name = arg(ctx.parsed, "name")!;
  await ctx.client().credentials.delete(name);
  if (ctx.json) ctx.printJson({ ok: true, deleted: name });
  else ctx.info(`${ctx.err.green("✓")} Deleted ${name}\n`);
  return 0;
}
