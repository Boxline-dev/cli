# boxline: the Boxline command line

Cloud browsers and shells for AI agents, from your terminal. Give the AI agent a task and watch it work, turn any
page into Markdown, a screenshot or a PDF, and open a terminal in an isolated machine.

```bash
npx @boxline/cli login                 # paste your API key (it is not shown while you type)
npx @boxline/cli run "Find the price of the cheapest plan on https://example.com/pricing"
```

Or install it: `npm install -g @boxline/cli`. Node 20 or newer. Built on the [Node SDK](https://www.npmjs.com/package/@boxline/sdk) (`@boxline/sdk`).

- [Your API key](#your-api-key)
- [Run the AI agent](#run-the-ai-agent)
- [Saved tasks](#saved-tasks)
- [Secrets](#secrets)
- [Search](#search)
- [Pages: fetch, screenshot, pdf, extract, crawl](#pages-fetch-screenshot-pdf-extract-crawl)
- [Sessions](#sessions)
- [Shell and files](#shell-and-files)
- [Output for programs](#output-for-programs)
- [Exit codes](#exit-codes)
- [Every command](#every-command)

## Your API key

Create a key in the console (API keys), then:

```bash
boxline login                     # asks for the key, checks it, saves it
boxline whoami                    # the project, plan and API it belongs to
boxline logout                    # forgets it
```

- The key is saved in your user config folder, in a file only you can read (mode 600):
  `~/Library/Application Support/boxline/config.json` on macOS, `~/.config/boxline/config.json` on Linux
  (`$XDG_CONFIG_HOME`), `%APPDATA%\boxline\config.json` on Windows. `BOXLINE_CONFIG_DIR` picks another folder.
- `BOXLINE_API_KEY`, when set, is used instead of the saved key (handy in CI).
- `BOXLINE_API_URL` picks the API (default `https://api.boxline.dev`). `boxline login --api-url <url>` saves the key
  for that API, and a saved key is only ever sent to the API it was saved for.
- Piped input works for scripts: `boxline login < key.txt`. The key is never printed.

## Run the AI agent

```bash
boxline run "Open https://example.com and tell me what the page is about"
boxline run "Download the CSV from https://example.com/report and add up the revenue column" --shell
```

The steps show as they happen: pages opened, clicks and typing, bash commands with their output live, CAPTCHAs, and
the model's thinking (dimmed). The answer comes last, on stdout, so `boxline run "…" > answer.txt` keeps just the
answer. Ctrl+C stops the run.

```
Agent run run_8f2k… · openai gpt-6-sol · session 3c1e…
  I'll open the page first.
→ browser_navigate https://example.com  1.2 s
    Loaded https://example.com/ (HTTP 200) — title: Example Domain
✓ completed in 6.4 s · 4,210 tokens · $0.0210

The page is the placeholder site for documentation examples.
```

| Option | What it does |
|---|---|
| `--shell` | Give the agent a bash shell (Python, Node, sudo) next to the browser |
| `--session <id>` | Work in a session you started (it keeps its own settings) |
| `--model <id>` | Pick the model, e.g. `claude-sonnet-5` or `gpt-6-sol` |
| `--var name=value` | A value the task uses as `%name%` |
| `--secret NAME` | A secret the task uses as `%NAME%`, read from the environment variable `NAME` |
| `--secret NAME@https://example.com` | The same, typed only into fields on that site (recommended for passwords) |
| `--captcha ask\|solve\|ignore` | When a CAPTCHA appears: ask a person (default), try to solve it (paid plans), or carry on |
| `--keep` | Keep the run's session afterwards (to look at it, or run more) |
| `--steps <n>` | Stop after this many steps, 1 to 1000 (default 30); `--steps none` (or `--no-step-limit`): no step limit |
| `--max-cost <usd>` | Stop once the run's model cost reaches this many US dollars (0.01 to 100) |
| `--timeout <seconds>` | The run's own session's time (default 1800, or your plan's maximum); the run stops when it ends |

Secrets never go on the command line (shell history and process lists would show them): put the value in the
environment and pass its name.

```bash
export SITE_PASSWORD=…            # or read it from your password manager
boxline run "Sign in to https://example.com as %email% with %SITE_PASSWORD% and open the billing page" \
  --var email=ada@example.com --secret SITE_PASSWORD@https://example.com
```

The model only ever sees `%SITE_PASSWORD%`; the platform fills in the value right before typing, and hides it in
everything it shows and keeps.

When the agent asks for help (to sign in, say) the run pauses: open the browser with the command it shows
(`boxline sessions live <id>`), do what is needed, then press Enter in the terminal to hand the browser back (type a
note first if you like), or type your answer and press Enter. A CAPTCHA that waits for a person works the same way, and
the run carries on by itself once it is solved.

While the run works, type a line and press Enter to tell the agent something ("also check page C"): it reads it at its
next step, and the line is echoed as `you: …`. From another terminal: `boxline message <runId> "…"`.

### When a run stops at a limit

A run stops at its step limit, its cost limit (`--max-cost`), or after 5 tool errors in a row. It then says what it
managed and what is left, keeps its session for 10 minutes, and tells you how to go on:

```
✗ stopped after 30 steps without finishing (4 min · 81,200 tokens · $0.41)
  Downloaded the video and cut 3 reels. The upload to the site is left.
Continue: boxline continue run_8f2k… [--steps 30] [--note "..."] (until 14:05)
```

`boxline continue <runId>` starts a new run in the same session that knows what the first one did, and shows it the
same way (`--steps`, `--max-cost`, `--note`; a run that had `--var` or `--secret` values needs them again). The exit code
stays 1 for a run that stopped at a limit.

## Saved tasks

A task is a saved agent run (an instruction with `%name%` variables, and often an output schema), made in the console
or with an SDK. Run one and get its result:

```bash
boxline tasks list                               # --limit 50, --all
boxline tasks run <id> --var category=Poetry     # waits, then prints the result on stdout
SITE_PASSWORD=… boxline tasks run <id> --secret SITE_PASSWORD > result.json
```

`tasks run` waits until the run ends and prints the result: JSON when the task has an output schema, else the answer's
text; the task's defaults fill the variables you leave out. `--secret NAME` passes a secret variable from the
environment variable `NAME` (the task itself says where it may be typed). `--session <id>` runs it in a session you
started. With `--json` it prints the whole task run. Ctrl+C stops the run.

## Secrets

Project secrets are write-only: the AI types them as `%NAME%` (scope `agent`, the default) and shells get them as
`$NAME` (scope `shell`), or both (`all`). The value never goes on the command line, where shell history and process lists
would show it: `set` asks for it without showing what you type, or reads it from a pipe.

```bash
boxline secrets set GITHUB_TOKEN --scope shell                    # asks for the value (hidden)
boxline secrets set SITE_PASSWORD --origin https://example.com < password.txt
boxline secrets list                                             # names, scope, sites; never the values
boxline secrets delete GITHUB_TOKEN
```

`set` on a name that exists gives it the new value and keeps the options you leave out. Piped input is taken whole, less
one final line break, so keys of several lines work. `--shell` lets the AI use the secret in bash commands too.

## Search

```bash
boxline search "hono routing docs"                          # titles, addresses and snippets
boxline search "site:docs.python.org asyncio" --limit 5 --fetch 2   # and the top 2 pages as Markdown
boxline search "zod" --recency month --json                # the API's answer, for programs
```

Operators work in the query (`"exact words"`, `-word`, `site:`, `filetype:`). Each search counts against the plan's
monthly searches; the same search within an hour is free.

## Pages: fetch, screenshot, pdf, extract, crawl

Every page is opened by a real browser inside a sandbox, never on your computer.

```bash
boxline fetch https://example.com                       # Markdown on stdout
boxline fetch https://example.com --format text > page.txt
boxline screenshot https://example.com                  # saves example.com.png
boxline screenshot https://example.com -o shot.jpg --full-page
boxline pdf https://example.com -o example.pdf
boxline extract https://example.com/pricing --prompt "the plan names and prices"
boxline extract https://example.com/product --schema product.json   # a JSON Schema file
boxline crawl https://example.com/docs --limit 50 -o docs           # one Markdown file per page
```

`-o -` writes a screenshot or PDF to stdout. `--proxy residential:DE` (or `datacenter`, or your own
`http://user:pass@host:port`) opens the page through a proxy. robots.txt is respected when crawling.

## Sessions

A session is one isolated machine with a browser and, if you ask for it, a shell, sharing one `/workspace` disk.

```bash
boxline sessions create --shell                 # add --proxy, --timeout 900, --idle-timeout 300, --captcha solve…
boxline sessions list                           # --status running, --limit 50, --all
boxline sessions get <id>
boxline sessions live <id>                      # the live view link: watch and take over in a browser
boxline sessions release <id>                   # stop it (billing stops)
```

The live view link works like a password: anyone who has it can watch and control the browser. In text output the
CLI prints it only when you ask (`sessions live`); `--json` prints the API's answer as it is, signed URLs included
(`connectUrl` for Playwright, `liveUrl`, `terminalUrl`), so keep that output out of shared logs.

## Shell and files

```bash
boxline exec <id> -- ls -la                     # streams the output, exits with the command's exit code
boxline exec <id> -- 'python3 -c "print(2**10)" | tee out.txt'
boxline shell <id>                              # an interactive terminal; Ctrl+D leaves

boxline files ls <id> downloads
boxline files get <id> downloads/report.csv     # saves report.csv here ("-" prints it)
boxline files put <id> data/input.csv ./input.csv
echo hello | boxline files put <id> hello.txt -
boxline files rm <id> hello.txt
```

`exec` runs the words after `--` in bash, joined with spaces (like ssh), in the session's persistent shell: `cd` and
`export` carry over to the next command. `--cwd`, `--env NAME=value` and `--timeout <seconds>` are there when you need
them. In `boxline shell`, Ctrl+C goes to the remote program, Ctrl+D (or `exit`) leaves, and Ctrl+] disconnects at
once; the session keeps running either way.

## Output for programs

Every command takes `--json`: it prints the API's answer as JSON on stdout and nothing else. Errors are JSON too:

```json
{ "error": { "code": "not_found", "message": "not found", "status": 404, "requestId": "req_…" } }
```

For people, errors look like `Error: <message> (request id req_…)`: quote the request id when asking for support.
Colours are used only on a terminal, never when `NO_COLOR` is set (`FORCE_COLOR=1` turns them on without one).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done (for `run` and `tasks run`: the run completed) |
| 1 | An error: from the API, the network, or a run that failed or stopped at a limit |
| 2 | A mistake in the command line (the message says which) |
| 124 | `exec`: the command ran out of time |
| 130 | Stopped with Ctrl+C |
| other | `exec`: the command's own exit code |

## Every command

| Command | What it does |
|---|---|
| `boxline run "<task>"` | Give the AI agent a task and watch it work |
| `boxline continue <runId>` | Carry on a run that stopped at a limit, and watch it |
| `boxline message <runId> "<text>"` | Tell a working run something |
| `boxline tasks list` / `boxline tasks run <id>` | List saved tasks; run one and print its result |
| `boxline secrets list\|set\|delete` | Project secrets (`set` reads the value from a hidden prompt or stdin) |
| `boxline search "<query>"` | Search the web (and fetch the top pages) |
| `boxline fetch <url>` | Print a page as Markdown, HTML or text |
| `boxline screenshot <url>` | Save a screenshot of a page |
| `boxline pdf <url>` | Save a page as a PDF |
| `boxline extract <url>` | Pull structured data out of a page with AI |
| `boxline crawl <url>` | Follow links from a page and collect what they say |
| `boxline sessions list\|create\|get\|release\|live` | Manage sessions |
| `boxline exec <id> -- <command…>` | Run a command in a session's shell |
| `boxline shell <id>` | Open an interactive terminal in a session |
| `boxline files ls\|get\|put\|rm <id> <path> [local]` | Files in a session's workspace |
| `boxline usage` | Usage and cost (this month so far, or `--from` / `--to`) |
| `boxline whoami` | The project, plan and API of your key |
| `boxline login` / `boxline logout` | Save or forget your API key |

`boxline <command> --help` shows every option. Docs: https://docs.boxline.dev

---

This repository holds the Boxline command line (boxline). It is copied from Boxline's main repository on every change. Issues and pull requests are welcome here; accepted changes are made there and arrive with the next copy.
