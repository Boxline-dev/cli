/**
 * search, fetch, screenshot, pdf, extract, crawl: search results, and one page (or a few) rendered in a real browser
 * inside a sandbox.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CrawlJob, CrawlPage } from "@boxline/sdk";
import { arg, num, str } from "../args.js";
import type { Ctx } from "../context.js";
import { CliError, formatBytes, formatDuration, formatUsd, oneLine, table, UsageError } from "../output.js";
import { hostFileName, normalizeUrl, pageFileName, parseProxy } from "../values.js";

type Format = "markdown" | "html" | "text";
const EXT: Record<Format, string> = { markdown: "md", html: "html", text: "txt" };

const urlArg = (ctx: Ctx) => normalizeUrl(arg(ctx.parsed, "url")!, ctx.parsed.spec.path.join(" "));
const proxyOpt = (ctx: Ctx) => {
  const p = str(ctx.parsed, "proxy");
  return p === undefined ? {} : { proxy: parseProxy(p, ctx.parsed.spec.path.join(" ")) };
};

/** Writes bytes to a file, or to stdout for "-". Returns the path written ("-" for stdout). */
function save(ctx: Ctx, target: string, bytes: Uint8Array): string {
  if (target === "-") {
    ctx.stdout.write(bytes);
    return "-";
  }
  const path = resolve(target);
  try {
    writeFileSync(path, bytes);
  } catch (err) {
    throw new CliError(`could not write ${target}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  return path;
}

export async function searchCommand(ctx: Ctx): Promise<number> {
  const query = (arg(ctx.parsed, "query") ?? "").trim();
  if (!query) throw new UsageError("give a query", "search");
  const fetch = num(ctx.parsed, "fetch");
  const r = await ctx.client().search({
    query,
    limit: num(ctx.parsed, "limit"),
    country: str(ctx.parsed, "country"),
    language: str(ctx.parsed, "language"),
    recency: str(ctx.parsed, "recency") as "day" | "week" | "month" | "year" | undefined,
    fetch,
  });
  if (ctx.json) {
    ctx.printJson(r);
    return 0;
  }
  r.results.forEach((x, i) => {
    ctx.print(`${i + 1}. ${oneLine(x.title || "(no title)", 100)}\n   ${x.url}\n${x.snippet ? `   ${oneLine(x.snippet, 200)}\n` : ""}`);
    if (x.content) ctx.print(`\n${x.content.trim()}\n\n`);
    else if (x.error) ctx.print(`   ${ctx.err.yellow(`(not fetched: ${x.error.message})`)}\n`);
  });
  ctx.info(ctx.err.dim(`${r.results.length} results${r.cached ? " (from the last hour: not counted)" : ""} · ${formatDuration(r.ms)}\n`));
  return 0;
}

export async function fetchCommand(ctx: Ctx): Promise<number> {
  const url = urlArg(ctx);
  const format = (str(ctx.parsed, "format") ?? "markdown") as Format;
  const r = await ctx.client().fetch(url, { format, ...proxyOpt(ctx) });
  if (ctx.json) {
    ctx.printJson(r);
    return 0;
  }
  ctx.print(r.content.endsWith("\n") ? r.content : `${r.content}\n`);
  const status = r.status !== null && r.status >= 400 ? ctx.err.yellow(`HTTP ${r.status}`) : `HTTP ${r.status ?? "?"}`;
  ctx.info(ctx.err.dim(`${status} · ${oneLine(r.title || "(no title)", 60)} · ${r.finalUrl} · ${formatDuration(r.ms)}\n`));
  if (r.captcha) ctx.info(ctx.err.yellow(`Note: a CAPTCHA (${r.captcha}) waits for a person on this page, so the content may be the challenge.\n`));
  return 0;
}

export async function screenshotCommand(ctx: Ctx): Promise<number> {
  const url = urlArg(ctx);
  const target = str(ctx.parsed, "output") ?? hostFileName(url, "png");
  const format = /\.jpe?g$/i.test(target) ? "jpeg" : "png";
  const bytes = await ctx.client().screenshot(url, { fullPage: ctx.parsed.opts["full-page"] === true, format, ...proxyOpt(ctx) });
  const path = save(ctx, target, bytes);
  if (ctx.json) {
    if (path !== "-") ctx.printJson({ path, bytes: bytes.length, format });
    return 0;
  }
  if (path !== "-") ctx.info(`Saved ${target} ${ctx.err.dim(`(${formatBytes(bytes.length)})`)}\n`);
  return 0;
}

export async function pdfCommand(ctx: Ctx): Promise<number> {
  const url = urlArg(ctx);
  const target = str(ctx.parsed, "output") ?? hostFileName(url, "pdf");
  const bytes = await ctx.client().pdf(url, { ...proxyOpt(ctx) });
  const path = save(ctx, target, bytes);
  if (ctx.json) {
    if (path !== "-") ctx.printJson({ path, bytes: bytes.length });
    return 0;
  }
  if (path !== "-") ctx.info(`Saved ${target} ${ctx.err.dim(`(${formatBytes(bytes.length)})`)}\n`);
  return 0;
}

export async function extractCommand(ctx: Ctx): Promise<number> {
  const url = urlArg(ctx);
  const prompt = str(ctx.parsed, "prompt");
  const schemaFile = str(ctx.parsed, "schema");
  if (!prompt && !schemaFile) throw new UsageError("give --prompt, --schema or both", "extract");
  let schema: Record<string, unknown> | undefined;
  if (schemaFile) {
    let text: string;
    try {
      text = readFileSync(resolve(schemaFile), "utf8");
    } catch (err) {
      throw new CliError(`could not read ${schemaFile}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
    }
    try {
      schema = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CliError(`${schemaFile} is not valid JSON`);
    }
  }
  const model = str(ctx.parsed, "model");
  const r = await ctx.client().extract({ url, prompt, schema, model, ...proxyOpt(ctx) }, { timeoutMs: 300_000 });
  if (ctx.json) {
    ctx.printJson(r);
    return 0;
  }
  ctx.print(typeof r.data === "string" ? `${r.data}\n` : `${JSON.stringify(r.data, null, 2)}\n`);
  ctx.info(ctx.err.dim(`${r.model} · ${formatUsd(r.usage.costUsd)} · ${formatDuration(r.ms)}\n`));
  return 0;
}

export async function crawlCommand(ctx: Ctx): Promise<number> {
  const url = urlArg(ctx);
  const limit = num(ctx.parsed, "limit") ?? 20;
  const format = (str(ctx.parsed, "format") ?? "markdown") as Format;
  const dir = str(ctx.parsed, "output");
  const bx = ctx.client();
  let job: CrawlJob = await bx.crawl.start({ url, maxPages: limit, format });
  const id = job.id;
  let stopped = false;
  ctx.onInterrupt(async () => {
    stopped = true;
    ctx.info("\nStopping the crawl…\n");
    await bx.crawl.cancel(id).catch(() => undefined);
  });
  const live = ctx.stderr.isTTY && !ctx.json;
  ctx.info(ctx.err.dim(`Crawl ${id}: ${url}, up to ${limit} pages\n`));
  const t0 = Date.now();
  while (job.status === "running") {
    await new Promise((r) => setTimeout(r, 1000));
    job = await bx.crawl.get(id, { limit: 0 });
    if (live) ctx.stderr.write(`\r${ctx.err.dim(`${job.pagesDone} pages done, ${job.pagesFailed} failed, ${formatDuration(Date.now() - t0)}`)}\x1b[K`);
  }
  if (live) ctx.stderr.write("\r\x1b[K");
  ctx.onInterrupt(null);
  const pages: CrawlPage[] = [];
  for await (const p of bx.crawl.pages(id)) pages.push(p);

  if (dir) {
    mkdirSync(resolve(dir), { recursive: true });
    for (const p of pages) {
      if (p.content === null) continue;
      writeFileSync(join(resolve(dir), pageFileName(p.index, p.finalUrl ?? p.url, EXT[format])), p.content);
    }
  }
  if (ctx.json) {
    ctx.printJson({ ...job, data: pages, next: null });
  } else {
    const rows = pages.map((p) => [String(p.index), p.error ? ctx.out.red("failed") : String(p.status ?? "–"), oneLine(p.title ?? p.error ?? "", 50), p.finalUrl ?? p.url]);
    if (!dir) ctx.print(table(["#", "STATUS", "TITLE", "URL"], rows, ctx.out));
    const saved = dir ? `, saved in ${dir}/` : "";
    const robots = job.skippedByRobots ? `, ${job.skippedByRobots} skipped by robots.txt` : "";
    const line = `${job.pagesDone} pages${job.pagesFailed ? `, ${job.pagesFailed} failed` : ""}${robots}${saved} in ${formatDuration(Date.now() - t0)}`;
    if (job.status === "completed") ctx.info(`${ctx.err.green("✓")} ${line}\n`);
    else ctx.info(`${ctx.err.yellow(`■ crawl ${job.status}`)}: ${line}${job.error ? ` (${job.error})` : ""}\n`);
  }
  if (stopped || job.status === "canceled") return 130;
  return job.status === "completed" ? 0 : 1;
}
