# Changelog

## 0.2.0 (2026-10-03)

Built on the Node SDK 1.2 (`@boxline/sdk` `^1.2.0`).

### Added

- `boxline credentials list | set | delete` for passwords and secrets. `set NAME` makes a **secret** by default, or a
  **password** with `--type password` (also implied by `--username`, `--2fa` or `--remove-2fa`, and by an existing
  password's name): `--username`, one or more `--origin` (required for a password), `--2fa` (a 2FA setup key after the
  password), `--remove-2fa`, `--scope`, `--shell`, `--description`. Passwords, 2FA keys and secret values are read from
  a hidden prompt or from stdin (a password on the first line, its 2FA key on the second), never from an argument:
  there is no option that takes one. `list` shows the type, sites, a password's user name and 2FA, a secret's preview,
  never a value.
- Making a credential that only the AI could use readable by shells (`credentials set NAME --scope shell|all`, or
  `--shell`) needs its values again, like a new `--origin`: a password with 2FA also needs `--2fa` (or `--remove-2fa`).
  The platform refuses the change otherwise.
- `boxline run --credential NAME` (repeatable): the AI may type the saved credential, as `%NAME%` or
  `%NAME.username%`, `%NAME.password%` and `%NAME.otp%`, only on its sites. A continued run keeps its credentials.

### Changed (breaking)

- `boxline secrets list | set | delete` are gone: use `boxline credentials …` (a secret is `--type secret`, the
  default). `--secret NAME` on `run`, `continue` and `tasks run` is unchanged: it still passes a value from the
  environment for one run.

## 0.1.1 (2026-10-02)

- The help's first line is Boxline's main line: the infrastructure AI agents need.

## 0.1.0 (2026-10-02)

Published on npm as `@boxline/cli` (npm refused the unscoped name `boxline`); the command is `boxline`.

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
