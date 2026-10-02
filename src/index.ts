#!/usr/bin/env node
/** Entry point of `boxline` / `npx @boxline/cli`. */
import { main } from "./cli.js";

// `boxline fetch … | head` closes the pipe early: stop quietly instead of printing EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw err;
  });
}

const code = await main(process.argv.slice(2));
// Let stdout drain (a large page piped into a file) before exiting; open sockets must not keep the process alive.
process.stderr.write("", () => process.stdout.write("", () => process.exit(code)));
