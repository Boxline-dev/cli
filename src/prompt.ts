/** Reading from the person at the keyboard: a hidden prompt for the API key. */
import { CliError } from "./output.js";

/** Ctrl+C during a prompt (exit code 130). */
export class Interrupted extends CliError {
  constructor() {
    super("stopped", "interrupted", 130);
  }
}

/** Everything piped into stdin, as bytes. */
export async function readStdinBytes(stdin: NodeJS.ReadStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

/** Everything piped into stdin, as text. */
export const readStdin = async (stdin: NodeJS.ReadStream) => (await readStdinBytes(stdin)).toString("utf8");

/**
 * Asks for a secret without showing what is typed (not even stars). Backspace and Ctrl+U edit, Enter ends, Ctrl+C
 * stops. Without a terminal it reads the first line of stdin (`boxline login < key.txt`).
 */
export async function readSecret(question: string, stdin: NodeJS.ReadStream, stderr: NodeJS.WriteStream): Promise<string> {
  if (!stdin.isTTY) return (await readStdin(stdin)).split(/\r?\n/)[0]!.trim();
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          finish();
          return resolve(value);
        }
        if (ch === "\u0003") {
          finish();
          return reject(new Interrupted());
        }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else if (ch === "\u0015") value = "";
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
