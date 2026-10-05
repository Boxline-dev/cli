/**
 * How `boxline run` shows an agent run: one line per step (browser_* tools, bash with its live output, CAPTCHAs,
 * hand-overs), the model's thought text dimmed, and a summary at the end. Pure: events in, text out (for stderr).
 */
import type { AgentRun, AgentRunEvent, AgentRunStarted, AgentStep } from "@boxline/sdk";
import { formatCount, formatDuration, formatUsd, oneLine, plain, type Style } from "./output.js";

export interface RenderOptions {
  style?: Style;
  /** Terminal width, for cutting long lines. */
  columns?: number;
}

const STEP_TYPES = new Set(["text", "tool", "handover", "handback", "captcha", "message"]);
export const isStep = (e: AgentRunEvent): e is AgentStep => STEP_TYPES.has(e.type);

/** Tool outputs worth a second line: what a click or typing acted on and the page after it, or what was read. */
const SHOW_OUTPUT = new Set(["browser_navigate", "browser_read", "browser_tabs", "browser_click", "browser_double_click", "browser_right_click", "browser_type", "browser_select", "browser_press", "browser_key"]);

/** A one-line summary of a tool's input (variables show as %name%: the API never returns their values). */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const target = () =>
    i.element !== undefined ? `#${i.element}` : typeof i.selector === "string" ? i.selector : i.x !== undefined ? `(${i.x}, ${i.y})` : "";
  switch (name) {
    case "browser_navigate":
      return String(i.url ?? "");
    case "browser_click":
      return target();
    case "browser_type":
      return `${JSON.stringify(String(i.text ?? ""))}${target() ? ` into ${target()}` : ""}`;
    case "browser_select":
      return `${JSON.stringify(String(i.option ?? ""))}${target() ? ` in ${target()}` : ""}`;
    case "browser_press":
      return String(i.key ?? "");
    case "browser_scroll":
      return i.deltaY !== undefined ? `${Number(i.deltaY) >= 0 ? "down" : "up"} ${Math.abs(Number(i.deltaY))}px` : "";
    case "browser_read":
      return typeof i.format === "string" ? i.format : "";
    case "browser_switch_tab":
      return i.index !== undefined ? `tab ${i.index}` : "";
    case "bash":
      return i.restart ? "(restart the shell)" : String(i.command ?? "");
    case "browser_screenshot":
    case "browser_back":
    case "browser_tabs":
      return "";
    default: {
      const text = JSON.stringify(i);
      return text === "{}" ? "" : text;
    }
  }
}

/** How a run that stopped at one of its limits is summed up (null for other endings). */
function limitHeadline(run: AgentRun): string | null {
  switch (run.errorCode) {
    case "max_steps": {
      const n = run.maxSteps ?? Number(/stopped after (\d+) steps/.exec(run.error ?? "")?.[1] ?? NaN);
      return Number.isFinite(n) ? `stopped after ${n} steps without finishing` : "stopped at its step limit without finishing";
    }
    case "max_cost":
      return run.maxCostUsd ? `stopped at its cost limit ($${run.maxCostUsd}) without finishing` : "stopped at its cost limit without finishing";
    case "too_many_errors":
      return `stopped after ${run.maxConsecutiveErrors ?? 5} tool errors in a row`;
    case "no_progress":
      return "stopped: it kept making the same call with the same result";
    default:
      return null;
  }
}

/** A time as the local clock shows it, e.g. 14:05. */
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** The exit code a bash tool output ends with ("[exit code 3]"); 0 when it has none. */
export const bashExitCode = (output: string | undefined) => Number(/\[exit code (\d+)\]\s*(\[stopped after[^\]]*\])?\s*$/.exec(output ?? "")?.[1] ?? 0);

export class RunRenderer {
  private readonly s: Style;
  private readonly columns: number;
  /** The command of the bash call whose live output is being shown. */
  private liveCommand: string | null = null;
  private atLineStart = true;
  /** The stream whose live output line is still open on screen, and streams whose line was ended for them. */
  private openLine: "stdout" | "stderr" | null = null;
  private readonly owesNewline = new Set<"stdout" | "stderr">();
  /** A text step held back until the next event: when the run ends with the same text, it is the answer (printed on stdout). */
  private pending: string | null = null;
  /** Steps shown so far: a reconnected stream replays them from the start. */
  steps = 0;
  /** Messages this terminal sent (echoed as "you: …" then): their steps only say the agent got them. */
  readonly sent = new Set<string>();

  constructor(
    private readonly sessionId: string,
    opts: RenderOptions = {},
  ) {
    this.s = opts.style ?? plain;
    this.columns = Math.max(40, opts.columns ?? 100);
  }

  header(run: AgentRunStarted, opts: { ownSession: boolean; continuedFrom?: string }): string {
    const where = opts.ownSession ? `session ${run.sessionId}` : `in session ${run.sessionId}`;
    const from = opts.continuedFrom ? ` · continues ${opts.continuedFrom}` : "";
    return this.s.dim(`Agent run ${run.id} · ${run.provider} ${run.model} · ${where}${from}`) + "\n";
  }

  /** The echo of a message typed in this terminal (sent with agent.sendMessage). */
  youSaid(text: string): string {
    return `${this.s.bold("you:")} ${oneLine(text, this.columns - 5)}\n`;
  }

  /** The text for one event of the run's stream ("" when it shows nothing). */
  event(e: AgentRunEvent): string {
    if (e.type === "text") {
      const out = this.flush();
      this.steps++;
      this.pending = e.text ?? "";
      return out;
    }
    if (e.type === "done") {
      // The final text step is the answer: drop it here, the caller prints the result.
      if (this.pending !== null && this.pending.trim() === (e.result ?? "").trim()) this.pending = null;
      return this.flush() + this.endLive();
    }
    let out = this.flush();
    switch (e.type) {
      case "status":
        return out; // hand-overs and CAPTCHAs are shown by their steps
      case "exec":
        out += this.endLive();
        this.liveCommand = e.command;
        this.atLineStart = true;
        return out + `${this.s.cyan("$")} ${this.clip(e.command, 2)}\n`;
      case "output":
        return out + this.live(e.data, e.stream);
      case "tool":
        this.steps++;
        return out + this.tool(e);
      case "handover":
        this.steps++;
        return out + this.endLive() + this.handover(e);
      case "handback":
        this.steps++;
        return out + this.endLive() + this.s.green("▶ ") + `Handed back to the agent${e.text ? `: ${oneLine(e.text, this.columns - 30)}` : ""}\n`;
      case "captcha":
        this.steps++;
        return out + this.endLive() + this.captcha(e);
      case "message": {
        this.steps++;
        const mine = e.id !== undefined && this.sent.has(e.id);
        return out + this.endLive() + (mine ? `  ${this.s.dim("(the agent got your message)")}\n` : this.youSaid(e.text ?? ""));
      }
      default:
        return out;
    }
  }

  /** Held-back text, if any (shown when the next event comes, or when the stream gives up). */
  flush(): string {
    if (this.pending === null) return "";
    const text = this.pending;
    this.pending = null;
    if (!text.trim()) return "";
    return this.endLive() + text.trim().split("\n").map((l) => `  ${this.s.dim(l)}`).join("\n") + "\n";
  }

  /** The line after the run: status, time, tokens and cost. */
  summary(run: AgentRun, elapsedMs: number): string {
    const tokens = run.usage.inputTokens + run.usage.outputTokens;
    const parts = [formatDuration(elapsedMs), `${formatCount(tokens)} tokens`];
    if (run.usage.costUsd !== null) parts.push(formatUsd(run.usage.costUsd));
    const facts = this.s.dim(` in ${parts.join(" · ")}`);
    if (run.status === "completed") return `${this.s.green("✓ completed")}${facts}\n`;
    if (run.status === "canceled") return `${this.s.yellow("■ stopped")}${facts}\n`;
    const limit = limitHeadline(run);
    if (limit) {
      // Stopped at a limit: what it managed (the model's own words) and how to go on.
      const lines = [`${this.s.red(`✗ ${limit}`)}${this.s.dim(` (${parts.join(" · ")})`)}`];
      if (run.resultText) lines.push(...run.resultText.trim().split("\n").map((l) => `  ${l}`));
      if (run.continuable) {
        const cost = run.errorCode === "max_cost" ? " [--max-cost USD]" : "";
        lines.push(this.s.bold(`Continue: boxline continue ${run.id} [--steps 30]${cost} [--note "..."]`) + this.s.dim(` (until ${clock(run.continuable.until)})`));
      }
      return lines.join("\n") + "\n";
    }
    return `${this.s.red("✗ failed")}${facts}${run.error ? `: ${run.error}` : ""}\n`;
  }

  // ---------------------------------------------------------------- pieces

  private tool(step: AgentStep): string {
    const name = step.name ?? "tool";
    const ms = step.ms !== undefined ? this.s.dim(`  ${formatDuration(step.ms)}`) : "";
    const thought = (step as { thought?: unknown }).thought;
    const pre = typeof thought === "string" && thought.trim() ? `  ${this.s.dim(oneLine(thought, this.columns - 2))}\n` : "";
    if (name === "bash") {
      const command = String((step.input as { command?: unknown } | undefined)?.command ?? "");
      const wasLive = this.liveCommand !== null && this.liveCommand === command;
      let out = pre + this.endLive();
      this.liveCommand = null;
      // Not seen live (a step from before this stream started): show the command and the start of its output.
      if (!wasLive) {
        out += `${this.s.cyan("$")} ${this.clip(toolSummary(name, step.input), 2)}\n`;
        const lines = (step.output ?? "").replace(/\n?\[exit code \d+\][\s\S]*$/, "").split("\n").filter(Boolean);
        for (const l of lines.slice(0, 8)) out += `  ${this.s.dim(this.clip(l, 2))}\n`;
        if (lines.length > 8) out += `  ${this.s.dim(`… ${lines.length - 8} more lines`)}\n`;
      }
      if (step.isError) return out + `${this.s.red("✗ bash failed:")} ${oneLine(step.output ?? "", this.columns - 14)}\n`;
      const code = bashExitCode(step.output);
      if (code) return out + `  ${this.s.yellow(`exit code ${code}`)}${ms}\n`;
      return out;
    }
    const summary = toolSummary(name, step.input);
    const head = step.isError ? this.s.red("✗ ") + this.s.red(name) : this.s.cyan("→ ") + this.s.bold(name);
    let out = pre + `${head}${summary ? ` ${this.clip(summary, name.length + 3)}` : ""}${ms}\n`;
    if (step.isError) out += `    ${this.s.red(oneLine(step.output ?? "failed", this.columns - 4))}\n`;
    else if (SHOW_OUTPUT.has(name) && step.output) out += `    ${this.s.dim(oneLine(step.output.split("\n")[0]!, this.columns - 4))}\n`;
    return out;
  }

  private handover(step: AgentStep): string {
    const reason = step.text ? `: ${oneLine(step.text, this.columns - 40)}` : "";
    if (step.by === "agent") return `${this.s.yellow("⏸ The agent asks for your help")}${reason}\n${this.liveHint()}`;
    if (step.by === "captcha") return `${this.s.yellow("⏸ Paused for a CAPTCHA")}${reason}\n`;
    return `${this.s.yellow("⏸ Paused: someone took over the browser")}${reason}\n`;
  }

  private captcha(step: AgentStep): string {
    const what = `${step.kind ?? "CAPTCHA"}${step.host ? ` on ${step.host}` : ""}`;
    if (step.state === "solving") return `  ${this.s.yellow("CAPTCHA")} ${what}: solving it automatically…\n`;
    if (step.state === "waiting")
      return `  ${this.s.yellow("CAPTCHA")} ${what}: waiting for a person${step.reason ? ` (${step.reason})` : ""}\n${this.liveHint()}`;
    const by = step.by === "auto" ? "automatically" : "by a person";
    return `  ${this.s.green("CAPTCHA solved")} ${by}${step.ms !== undefined ? ` after ${formatDuration(step.ms)}` : ""}\n`;
  }

  private liveHint(): string {
    return this.s.dim(`  Open the browser: boxline sessions live ${this.sessionId}`) + "\n";
  }

  /**
   * Live bash output, indented; the indent goes at the start of every line. stdout and stderr arrive separately (each
   * may hold back a line end), so a line one of them left open is ended before the other writes, and its late line end
   * is then skipped.
   */
  private live(data: string, stream: "stdout" | "stderr"): string {
    if (this.owesNewline.delete(stream) && data.startsWith("\n")) data = data.slice(1);
    if (!data) return "";
    const paint = stream === "stderr" ? this.s.yellow : this.s.dim;
    let out = "";
    if (this.openLine && this.openLine !== stream) {
      out += "\n";
      this.owesNewline.add(this.openLine);
      this.atLineStart = true;
    }
    for (const piece of data.split(/(\n)/)) {
      if (piece === "\n") {
        out += "\n";
        this.atLineStart = true;
      } else if (piece) {
        out += (this.atLineStart ? "  " : "") + paint(piece);
        this.atLineStart = false;
      }
    }
    this.openLine = this.atLineStart ? null : stream;
    return out;
  }

  /** Ends a half-written output line, so the next step starts on its own line. */
  private endLive(): string {
    this.owesNewline.clear();
    this.openLine = null;
    if (this.atLineStart) return "";
    this.atLineStart = true;
    return "\n";
  }

  private clip(s: string, used: number) {
    return oneLine(s, Math.max(20, this.columns - used));
  }
}
