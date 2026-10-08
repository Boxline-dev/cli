/** files ls | get | put | rm: the session's /workspace (shared by the shell and the browser's downloads). */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NotADirectoryError, type FileList } from "@boxline/sdk";
import { arg } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, formatBytes, formatDate, table, type Style } from "../output.js";
import { readStdinBytes } from "../prompt.js";
import { baseName } from "../values.js";

export function filesTable(listing: FileList, s: Style): string {
  const entries = [...listing.entries].sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  return table(
    ["SIZE", "MODIFIED", "NAME"],
    entries.map((e) => [e.type === "dir" ? "–" : formatBytes(e.size), formatDate(e.mtime), e.type === "dir" ? s.cyan(`${e.name}/`) : e.name]),
    s,
  );
}

const localError = (what: string, file: string, err: unknown) =>
  new CliError(`could not ${what} ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);

export async function ls(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  const listing = await ctx.client().sessions.files.list(id, arg(ctx.parsed, "path") ?? ".");
  if (ctx.json) ctx.printJson(listing);
  else if (!listing.entries.length) ctx.info(`${listing.path} is empty.\n`);
  else ctx.print(filesTable(listing, ctx.out));
  return 0;
}

/** What a folder is saved as by default: `<folder>.tar.gz` (the whole workspace: workspace.tar.gz). */
export const archiveName = (path: string) => `${baseName(path === "." || path === "/" ? "workspace" : path) || "workspace"}.tar.gz`;

export async function get(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  const path = arg(ctx.parsed, "path")!;
  const bx = ctx.client();
  // A folder comes down as one .tar.gz, a file as itself. Listing a file is the API's 400 not_a_directory, so one call tells which it is.
  const isFolder = await bx.sessions.files.list(id, path).then(
    () => true,
    (err: unknown) => {
      if (err instanceof NotADirectoryError) return false;
      throw err;
    },
  );
  const fallback = isFolder ? archiveName(path) : baseName(path) || "download";
  let local = arg(ctx.parsed, "local") ?? fallback;
  const bytes = isFolder ? await bx.sessions.files.archive(id, path === "." || path === "/" ? undefined : path) : await bx.sessions.files.read(id, path);
  if (local === "-") {
    ctx.stdout.write(bytes);
    return 0;
  }
  if (existsSync(local) && statSync(local).isDirectory()) local = join(local, fallback);
  try {
    writeFileSync(resolve(local), bytes);
  } catch (err) {
    throw localError("write", local, err);
  }
  if (ctx.json) ctx.printJson({ path, local: resolve(local), size: bytes.length });
  else ctx.info(`Saved ${local} ${ctx.err.dim(`(${formatBytes(bytes.length)})`)}\n`);
  return 0;
}

export async function put(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  let path = arg(ctx.parsed, "path")!;
  const local = arg(ctx.parsed, "local") ?? baseName(path);
  if (!local) throw new CliError("name the local file to upload: boxline files put <id> <path> <local>");
  let data: Uint8Array;
  if (local === "-") data = await readStdinBytes(ctx.stdin);
  else {
    try {
      data = readFileSync(resolve(local));
    } catch (err) {
      throw localError("read", local, err);
    }
  }
  // "data/" means "into the data folder, under the same name".
  if (path.endsWith("/")) path += local === "-" ? "stdin.txt" : basename(local);
  const ref = await ctx.client().sessions.files.write(id, path, data);
  if (ctx.json) ctx.printJson(ref);
  else ctx.info(`Uploaded ${local === "-" ? "stdin" : local} to ${ref.path} ${ctx.err.dim(`(${formatBytes(ref.size)})`)}\n`);
  return 0;
}

export async function rm(ctx: Ctx): Promise<number> {
  const id = arg(ctx.parsed, "id")!;
  const path = arg(ctx.parsed, "path")!;
  await ctx.client().sessions.files.delete(id, path);
  if (ctx.json) ctx.printJson({ ok: true, path });
  else ctx.info(`Deleted ${path}\n`);
  return 0;
}
