/** Picks the command from the first words of the command line (pure: the unit tests call it directly). */
import { closest, commandHelp, commandName, groupHelp, parseCommand, type CommandSpec, type Parsed } from "./args.js";
import { UsageError } from "./output.js";
import { GROUPS, mainHelp, SPECS } from "./spec.js";
import { VERSION } from "./version.js";

export type Route = { kind: "help"; text: string } | { kind: "version"; text: string } | { kind: "command"; name: string; parsed: Parsed };

const HELP = new Set(["-h", "--help", "help"]);
const find = (path: string[]) => SPECS.find((s) => commandName(s) === path.join(" "));

function helpFor(words: string[]): string {
  const [first, second] = words;
  if (!first) return mainHelp(VERSION);
  if (GROUPS.includes(first) && !second) return groupHelp(first, SPECS);
  const spec = find(GROUPS.includes(first) ? [first, second!] : [first]);
  if (!spec) throw new UsageError(`unknown command "${words.join(" ")}"`);
  return commandHelp(spec);
}

export function route(argv: string[]): Route {
  const [first, ...more] = argv;
  if (first === undefined || HELP.has(first)) return { kind: "help", text: helpFor(first === undefined ? [] : more) };
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version", text: `${VERSION}\n` };
  let spec: CommandSpec | undefined;
  let rest: string[];
  if (GROUPS.includes(first)) {
    const [sub, ...after] = more;
    if (sub === undefined || HELP.has(sub)) return { kind: "help", text: groupHelp(first, SPECS) };
    spec = find([first, sub]);
    if (!spec) {
      const subs = SPECS.filter((s) => s.path[0] === first).map((s) => s.path[1]);
      const near = closest(sub, subs as string[]);
      throw new UsageError(`unknown command "${first} ${sub}" (${near ? `did you mean ${first} ${near}?` : `use one of: ${subs.join(", ")}`})`, first);
    }
    rest = after;
  } else {
    spec = find([first]);
    if (!spec) {
      if (first.startsWith("-")) throw new UsageError(`unknown option ${first}`);
      const near = closest(first, [...new Set(SPECS.map((s) => s.path[0]!))]);
      throw new UsageError(`unknown command "${first}"${near ? ` (did you mean ${near}?)` : ""}`);
    }
    rest = more;
  }
  const parsed = parseCommand(spec, rest);
  if (parsed.help) return { kind: "help", text: commandHelp(spec) };
  return { kind: "command", name: commandName(spec), parsed };
}
