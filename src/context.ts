/** What every command gets: its parsed arguments, output helpers, the API client and Ctrl+C handling. */
import { Boxline } from "@boxline/sdk";
import type { Parsed } from "./args.js";
import { resolveCredentials, type Credentials } from "./config.js";
import { CliError, colorEnabled, json, makeStyle, type Style } from "./output.js";
import { VERSION } from "./version.js";

type Interrupt = () => void | Promise<void>;

export class Ctx {
  readonly json: boolean;
  /** Colours for stdout and stderr (each only on a terminal, never with NO_COLOR). */
  readonly out: Style;
  readonly err: Style;
  readonly env = process.env;
  readonly stdout = process.stdout;
  readonly stderr = process.stderr;
  readonly stdin = process.stdin;
  private creds: Credentials | null = null;
  private bx: Boxline | null = null;
  private interrupt: Interrupt | null = null;
  private interrupts = 0;

  constructor(readonly parsed: Parsed) {
    this.json = parsed.json;
    this.out = makeStyle(colorEnabled(process.stdout, process.env));
    this.err = makeStyle(colorEnabled(process.stderr, process.env));
  }

  get credentials(): Credentials {
    return (this.creds ??= resolveCredentials(this.env));
  }

  /** The SDK client; fails with a hint when there is no API key. */
  client(): Boxline {
    if (this.bx) return this.bx;
    const { apiKey, apiUrl, savedFor } = this.credentials;
    if (!apiKey && savedFor) {
      throw new CliError(`your saved key is for ${savedFor}, not ${apiUrl}: run "boxline login" for ${apiUrl}, or set BOXLINE_API_KEY`, "no_api_key");
    }
    if (!apiKey) throw new CliError('no API key: run "boxline login", or set BOXLINE_API_KEY', "no_api_key");
    this.bx = new Boxline({ apiKey, baseUrl: apiUrl, headers: { "user-agent": `boxline-cli/${VERSION} node/${process.versions.node}` } });
    return this.bx;
  }

  /** Text for people, on stdout. */
  print(text: string) {
    this.stdout.write(text);
  }
  /** Progress and notes for people, on stderr; silent with --json. */
  info(text: string) {
    if (!this.json) this.stderr.write(text);
  }
  /** The --json answer. */
  printJson(value: unknown) {
    this.stdout.write(json(value));
  }

  get columns() {
    return this.stderr.columns || 100;
  }

  /**
   * What Ctrl+C does while a command runs (e.g. cancel the agent run). A second Ctrl+C, or one with no handler,
   * exits at once with 130.
   */
  onInterrupt(fn: Interrupt | null) {
    this.interrupt = fn;
  }

  /** @internal Called by the SIGINT listener in cli.ts. */
  handleInterrupt(): boolean {
    this.interrupts++;
    if (!this.interrupt || this.interrupts > 1) return false;
    void Promise.resolve(this.interrupt()).catch(() => undefined);
    return true;
  }
}
