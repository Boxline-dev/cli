/**
 * The command line: a small parser driven by the command specs (spec.ts), and the help texts made from the same
 * specs, so help and behaviour cannot drift apart.
 *
 * Rules: options may come before or after arguments; `--name value` and `--name=value`; a string option takes the
 * next word as it is (so `-o -` means stdout); `--` ends the options (for `exec`, everything after it is the
 * command). Every command also takes --json and -h/--help.
 */
import { UsageError } from "./output.js";

export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  /** May be given more than once (collected in order). */
  multiple?: boolean;
  /** What the value looks like in help, e.g. "id" or "name=value". */
  value?: string;
  choices?: readonly string[];
  /** A whole number within these bounds. */
  integer?: { min?: number; max?: number };
  description: string;
}

export interface ArgSpec {
  name: string;
  optional?: boolean;
  /** Takes every remaining argument (only the last one). */
  variadic?: boolean;
}

export interface CommandSpec {
  /** ["sessions", "list"] */
  path: string[];
  summary: string;
  args: ArgSpec[];
  options: Record<string, OptionSpec>;
  /** For exec: the words after `--` (or after the arguments) are the command. */
  rest?: { name: string; required: boolean };
  /**
   * Said instead of `unexpected argument "…"` for extra words, for commands where an extra word could be a secret value
   * (the message must not show it).
   */
  extraArgsError?: string;
  /** Extra lines under the usage line. */
  notes?: string[];
  examples?: string[];
}

export type OptionValue = string | boolean | number | string[] | undefined;

export interface Parsed {
  spec: CommandSpec;
  args: Record<string, string | string[] | undefined>;
  opts: Record<string, OptionValue>;
  rest: string[];
  json: boolean;
  help: boolean;
}

const GLOBAL: Record<string, OptionSpec> = {
  json: { type: "boolean", description: "Print JSON for programs instead of text" },
  help: { type: "boolean", short: "h", description: "Show this help" },
};

export const commandName = (spec: CommandSpec) => spec.path.join(" ");

/** Parses the words after the command name against its spec. Throws UsageError with a plain message. */
export function parseCommand(spec: CommandSpec, argv: string[]): Parsed {
  const options = { ...spec.options, ...GLOBAL };
  const byShort = new Map(Object.entries(options).flatMap(([name, o]) => (o.short ? [[o.short, name] as const] : [])));
  const opts: Record<string, OptionValue> = {};
  const positionals: string[] = [];
  let rest: string[] = [];
  let sawDashes = false;
  const cmd = commandName(spec);

  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === "--") {
      sawDashes = true;
      if (spec.rest) rest = argv.slice(i + 1);
      else positionals.push(...argv.slice(i + 1));
      break;
    }
    let name: string | undefined;
    let inline: string | undefined;
    if (word.startsWith("--") && word.length > 2) {
      const eq = word.indexOf("=");
      name = eq === -1 ? word.slice(2) : word.slice(2, eq);
      inline = eq === -1 ? undefined : word.slice(eq + 1);
      if (!options[name]) throw new UsageError(`unknown option --${name}${suggest(name, Object.keys(options))}`, cmd);
    } else if (word.startsWith("-") && word.length === 2 && word !== "-") {
      name = byShort.get(word[1]!);
      if (!name) throw new UsageError(`unknown option ${word}`, cmd);
    } else if (word.startsWith("-") && word.length > 2 && !/^-\d/.test(word)) {
      throw new UsageError(`unknown option ${word} (long options start with --)`, cmd);
    }
    if (name === undefined) {
      positionals.push(word);
      continue;
    }
    const o = options[name]!;
    const label = `--${name}`;
    let value: OptionValue;
    if (o.type === "boolean") {
      if (inline !== undefined) throw new UsageError(`${label} takes no value`, cmd);
      value = true;
    } else {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`${label} needs a value${o.value ? ` (${o.value})` : ""}`, cmd);
      if (o.choices && !o.choices.includes(v)) throw new UsageError(`${label} must be one of: ${o.choices.join(", ")}`, cmd);
      if (o.integer) {
        const n = Number(v);
        const { min, max } = o.integer;
        if (!/^-?\d+$/.test(v) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
          const range = min !== undefined && max !== undefined ? ` from ${min} to ${max}` : min !== undefined ? ` of at least ${min}` : "";
          throw new UsageError(`${label} must be a whole number${range}`, cmd);
        }
        value = n;
      } else value = v;
    }
    if (o.multiple) opts[name] = [...((opts[name] as string[] | undefined) ?? []), String(value)];
    else opts[name] = value;
  }

  const help = opts.help === true;
  const json = opts.json === true;
  delete opts.help;
  delete opts.json;
  const args: Record<string, string | string[] | undefined> = {};
  if (help) return { spec, args, opts, rest, json, help };

  let k = 0;
  for (const a of spec.args) {
    if (a.variadic) {
      const all = positionals.slice(k);
      k = positionals.length;
      if (!all.length && !a.optional) throw new UsageError(`missing <${a.name}>`, cmd);
      args[a.name] = all;
      continue;
    }
    const v = positionals[k++];
    if (v === undefined && !a.optional) throw new UsageError(`missing <${a.name}>`, cmd);
    args[a.name] = v;
  }
  if (k < positionals.length) {
    // `boxline exec <id> ls` without "--": the extra words are the command.
    if (spec.rest && !sawDashes) rest = positionals.slice(k);
    else throw new UsageError(spec.extraArgsError ?? `unexpected argument "${positionals[k]}"`, cmd);
  }
  if (spec.rest?.required && rest.length === 0) throw new UsageError(`missing the ${spec.rest.name} (after --)`, cmd);
  return { spec, args, opts, rest, json, help };
}

/** The known word closest to a typo (at most two letters off), if any. */
export function closest(name: string, known: string[]): string | undefined {
  return known
    .map((k) => [k, distance(name, k)] as const)
    .filter(([, d]) => d <= 2)
    .sort((a, b) => a[1] - b[1])[0]?.[0];
}

/** " (did you mean --model?)" for a near miss. */
function suggest(name: string, known: string[]): string {
  const best = closest(name, known);
  return best ? ` (did you mean --${best}?)` : "";
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

// ------------------------------------------------------------------ typed readers for the handlers

export const str = (p: Parsed, name: string): string | undefined => {
  const v = p.opts[name];
  return typeof v === "string" ? v : undefined;
};
export const bool = (p: Parsed, name: string): boolean => p.opts[name] === true;
export const num = (p: Parsed, name: string): number | undefined => {
  const v = p.opts[name];
  return typeof v === "number" ? v : undefined;
};
export const list = (p: Parsed, name: string): string[] => {
  const v = p.opts[name];
  return Array.isArray(v) ? v : [];
};
export const arg = (p: Parsed, name: string): string | undefined => {
  const v = p.args[name];
  return Array.isArray(v) ? v.join(" ") : v;
};

// ------------------------------------------------------------------ help

function usageLine(spec: CommandSpec): string {
  const parts = ["boxline", ...spec.path];
  for (const a of spec.args) parts.push(a.optional ? `[${a.name}${a.variadic ? "…" : ""}]` : `<${a.name}${a.variadic ? "…" : ""}>`);
  if (Object.keys(spec.options).length) parts.push("[options]");
  if (spec.rest) parts.push(`-- <${spec.rest.name}…>`);
  return parts.join(" ");
}

function optionLabel(name: string, o: OptionSpec): string {
  const short = o.short ? `-${o.short}, ` : "    ";
  const value = o.type === "string" ? ` <${o.value ?? (o.choices ? o.choices.join("|") : "value")}>` : "";
  return `${short}--${name}${value}`;
}

/** The help text of one command. */
export function commandHelp(spec: CommandSpec): string {
  const lines = [`${spec.summary}`, "", `Usage: ${usageLine(spec)}`];
  if (spec.notes?.length) lines.push("", ...spec.notes);
  const all = Object.entries({ ...spec.options, ...GLOBAL });
  const labels = all.map(([n, o]) => optionLabel(n, o));
  const w = Math.max(...labels.map((l) => l.length));
  lines.push("", "Options:");
  all.forEach(([, o], i) => lines.push(`  ${labels[i]!.padEnd(w)}  ${o.description}${o.multiple ? " (repeat for more)" : ""}`));
  if (spec.examples?.length) lines.push("", "Examples:", ...spec.examples.map((e) => `  ${e}`));
  return lines.join("\n") + "\n";
}

/** Help for a group such as `boxline sessions`: its commands. */
export function groupHelp(group: string, specs: CommandSpec[]): string {
  const mine = specs.filter((s) => s.path[0] === group && s.path.length > 1);
  const names = mine.map((s) => s.path.slice(1).join(" "));
  const w = Math.max(...names.map((n) => n.length));
  return [`Usage: boxline ${group} <command> [options]`, "", "Commands:", ...mine.map((s, i) => `  ${names[i]!.padEnd(w)}  ${s.summary}`), "", `Run "boxline ${group} <command> --help" for more.`].join("\n") + "\n";
}
