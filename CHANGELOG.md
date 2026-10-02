# Changelog

## 0.1.0 (not published yet)

The first version of the `boxline` command line, built on the Node SDK 1.0.

- `boxline login` / `logout` / `whoami`: the API key is asked for without showing it, checked, and saved in the user
  config folder with mode 600; `BOXLINE_API_KEY` and `BOXLINE_API_URL` work too.
- `boxline run "<task>"`: an agent run whose steps show live (browser tools, bash with its output, CAPTCHAs,
  hand-overs, the model's thinking); the answer goes to stdout; Ctrl+C stops the run; Enter hands the browser back
  when the agent asks for help. `--shell`, `--session`, `--model`, `--var`, `--secret NAME[@site]`, `--captcha`,
  `--keep`, `--max-steps`.
- Run limits and Continue: `boxline run` takes `--steps n` (1 to 1000) or `--steps none` / `--no-step-limit`,
  `--max-cost USD` and `--timeout SECONDS` (`--max-steps` still works). A run that stops at a limit prints what it did
  and `Continue: boxline continue <runId> …` (exit code 1); `boxline continue <runId>` (`--steps`, `--max-cost`,
  `--note`, `--var`, `--secret`) carries it on in the same session, streamed like `run`.
- Messages: while `run` or `continue` streams on a terminal, a typed line is sent to the agent (echoed as `you: …`), and
  answers the agent when it asks for help; `boxline message <runId> "<text>"` sends one from anywhere.
- `boxline sessions create --idle-timeout SECONDS`.
- `boxline search "<query>"`: titles, addresses and snippets (`--limit`, `--country`, `--language`, `--recency`), and
  with `--fetch n` the top pages as Markdown; `--json` prints the API's answer.
- `boxline tasks list` and `boxline tasks run <id>`: a saved task's run, waited for, with its result printed on stdout
  (JSON with an output schema); `--var`, `--secret NAME` (from the environment), `--session`.
- `boxline secrets list`, `boxline secrets set NAME` (the value from a hidden prompt or stdin, never an argument;
  creates the secret or gives it a new value; `--scope`, `--origin`, `--shell`, `--description`) and
  `boxline secrets delete NAME`. A word after the name is refused without being printed.
- `boxline fetch`, `screenshot`, `pdf`, `extract`, `crawl`.
- `boxline sessions list|create|get|release|live`.
- `boxline exec <id> -- <command>` (streams, exits with the command's code) and `boxline shell <id>` (an interactive
  terminal: raw mode, resize, Ctrl+D leaves).
- `boxline files ls|get|put|rm`, `boxline usage`.
- `--json` on every command; colours only on a terminal and never with `NO_COLOR`; errors with the API's request id.
