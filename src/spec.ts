/** Every command: its arguments, options and help text. Handlers live in commands/. */
import type { CommandSpec } from "./args.js";

const CAPTCHA = ["ask", "solve", "ignore"] as const;
const FORMATS = ["markdown", "html", "text"] as const;
const PROXY_HELP = "A proxy: residential[:CC], datacenter[:CC], http://user:pass@host:port, or JSON";

export const SPECS: CommandSpec[] = [
  // ---------------------------------------------------------------- account
  {
    path: ["login"],
    summary: "Save your API key on this computer",
    args: [],
    options: {
      "api-url": { type: "string", value: "url", description: "The API to use with this key (default: BOXLINE_API_URL, then https://api.boxline.dev)" },
    },
    notes: [
      "Asks for the key without showing it, checks it with the API, and saves it in your user config folder",
      "(readable only by you). Piped input works too: boxline login < key.txt",
      "BOXLINE_API_KEY, when set, is used instead of the saved key.",
    ],
    examples: ["boxline login", "boxline login --api-url http://localhost:8080"],
  },
  {
    path: ["logout"],
    summary: "Forget the saved API key",
    args: [],
    options: {},
  },
  {
    path: ["whoami"],
    summary: "Show the project, plan and API this key belongs to",
    args: [],
    options: {},
  },
  {
    path: ["usage"],
    summary: "Show usage and cost (this month so far by default)",
    args: [],
    options: {
      from: { type: "string", value: "date", description: "Start date, e.g. 2026-09-01" },
      to: { type: "string", value: "date", description: "End date" },
    },
  },

  // ---------------------------------------------------------------- agent
  {
    path: ["run"],
    summary: "Give the AI agent a task and watch it work",
    args: [{ name: "task", variadic: true }],
    options: {
      shell: { type: "boolean", description: "Give the agent a bash shell next to the browser" },
      "no-browser": { type: "boolean", description: "Shell only, no browser (needs --shell): the agent works with the shell and the files" },
      session: { type: "string", value: "id", description: "Work in this session instead of a new one" },
      model: { type: "string", value: "id", description: "The model, e.g. claude-sonnet-5-5 or gpt-6-sol (default: the server's)" },
      var: { type: "string", multiple: true, value: "name=value", description: "A value the task uses as %name%" },
      secret: {
        type: "string",
        multiple: true,
        value: "NAME[@site]",
        description: "A secret from the environment variable NAME, used as %NAME% (the model never sees it)",
      },
      credential: {
        type: "string",
        multiple: true,
        value: "NAME",
        description: "A saved credential (see boxline credentials) the AI may type, as %NAME% or %NAME.password% (the model never sees it)",
      },
      captcha: { type: "string", choices: CAPTCHA, description: "When a CAPTCHA appears: ask a person (default), solve it, or ignore it" },
      keep: { type: "boolean", description: "Keep the run's session running afterwards" },
      steps: { type: "string", value: "n|none", description: 'Stop after this many steps, 1 to 1000 (default 30); "none": no step limit' },
      "no-step-limit": { type: "boolean", description: "Same as --steps none: the run goes until it is done or its session's time ends" },
      "max-cost": { type: "string", value: "usd", description: "Stop once the run's model cost reaches this many US dollars (0.01 to 100)" },
      timeout: { type: "string", integer: { min: 60 }, value: "seconds", description: "The run's own session's time (default 1800, or your plan's maximum)" },
    },
    notes: [
      "Steps are shown as they happen (on stderr); the answer is printed on stdout. Ctrl+C stops the run.",
      "While it works, type a line and press Enter to send the agent a message; it reads it at its next step.",
      "Exit code: 0 when the run completed, 1 when it failed or stopped at a limit, 130 when you stopped it.",
      "A run that stops at a limit (steps, cost, errors in a row) keeps its session for 10 minutes:",
      "  boxline resume <runId> carries it on: the same run, with more steps.",
      "",
      "Secrets: set the value in your environment, pass its name. Add @site to allow typing it only there:",
      "  --secret SITE_PASSWORD@https://example.com",
      "Saved credentials (boxline credentials set): pass --credential NAME; a password is typed as %NAME.username% and",
      "%NAME.password% (and %NAME.otp% with a 2FA key), only on the sites it was saved for.",
    ],
    examples: [
      'boxline run "Find the price of the cheapest plan on https://example.com/pricing"',
      'boxline run "Download the CSV from https://example.com/report and add up the revenue column" --shell',
      'SITE_PASSWORD=… boxline run "Sign in with %email% and %SITE_PASSWORD%" --var email=ada@example.com --secret SITE_PASSWORD@https://example.com',
      'boxline run "Sign in to https://shop.example.com with %SHOP.username% and %SHOP.password%, then list my orders" --credential SHOP',
      'boxline run "Convert every video in the workspace to MP4" --shell --steps none --max-cost 2 --timeout 3600',
      'boxline run "Write a script that sorts out the CSV files in the workspace and run it" --shell --no-browser',
    ],
  },
  {
    path: ["resume"],
    summary: "Go on with an agent run that stopped at a limit or was paused, and watch it",
    args: [{ name: "runId" }],
    options: {
      steps: { type: "string", value: "n|none", description: 'Steps for this stretch, 1 to 1000 (default: the run\'s own); "none": no step limit' },
      "no-step-limit": { type: "boolean", description: "Same as --steps none" },
      "max-cost": { type: "string", value: "usd", description: "The model cost this stretch may add, in US dollars (default: the run's own)" },
      note: { type: "string", value: "text", description: "An extra note for the agent (at most 2000 characters); a paused run is also told you had the browser" },
      var: { type: "string", multiple: true, value: "name=value", description: "The run's variables again (values are never stored)" },
      secret: { type: "string", multiple: true, value: "NAME", description: "A secret variable again, from the environment variable NAME" },
    },
    notes: [
      "The same run goes on (one job, one run id; its steps and usage add up). It works on a run that stopped at its step limit, its",
      "cost limit, after tool errors in a row or a server restart (within 10 minutes), and on a paused run (after a CAPTCHA, or",
      "when you took over in the live view). Shown like boxline run.",
      "A run that had --var or --secret values needs them again (they keep the sites they had).",
    ],
    examples: ["boxline resume run_Xy12Ab34Cd56Ef78", 'boxline resume run_Xy12Ab34Cd56Ef78 --steps 50 --note "The download is done; do the upload"', 'boxline resume run_Xy12Ab34Cd56Ef78 --note "I solved the CAPTCHA"'],
  },
  {
    path: ["message"],
    summary: "Tell a working agent run something (it reads it at its next step)",
    args: [{ name: "runId" }, { name: "text", variadic: true }],
    options: {},
    notes: ["A run waiting for your help takes the message as the answer. At most 50 messages per run."],
    examples: ['boxline message run_Xy12Ab34Cd56Ef78 "Also open page C and include its heading"'],
  },

  // ---------------------------------------------------------------- tasks
  {
    path: ["tasks", "list"],
    summary: "List saved tasks, newest first",
    args: [],
    options: {
      limit: { type: "string", integer: { min: 1, max: 200 }, value: "n", description: "How many (default 20)" },
      all: { type: "boolean", description: "Every task, page after page" },
    },
  },
  {
    path: ["tasks", "run"],
    summary: "Run a saved task, wait for it, and print its result",
    args: [{ name: "id" }],
    options: {
      var: { type: "string", multiple: true, value: "name=value", description: "A value for the task's %name%" },
      secret: {
        type: "string",
        multiple: true,
        value: "NAME",
        description: "A secret variable's value, from the environment variable NAME (the model never sees it)",
      },
      session: { type: "string", value: "id", description: "Work in this session instead of a new one" },
    },
    notes: [
      "Waits until the run ends, then prints the result on stdout: JSON when the task has an output schema, else the",
      "answer's text. Variables left out take the task's defaults. Ctrl+C stops the run.",
      "Exit code: 0 when the run completed, 1 when it failed, 130 when it was stopped.",
    ],
    examples: [
      "boxline tasks run task_Hk2Lq8Zx0Vb5Nm1C --var category=Poetry",
      "SITE_PASSWORD=… boxline tasks run task_Hk2Lq8Zx0Vb5Nm1C --secret SITE_PASSWORD > result.json",
    ],
  },

  // ---------------------------------------------------------------- credentials
  {
    path: ["credentials", "list"],
    summary: "List the project's credentials: passwords and secrets (never their values)",
    args: [],
    options: {
      limit: { type: "string", integer: { min: 1, max: 200 }, value: "n", description: "How many (default 100)" },
      all: { type: "boolean", description: "Every credential, page after page" },
    },
  },
  {
    path: ["credentials", "set"],
    summary: "Create a credential, or give one new values (read from a hidden prompt or stdin)",
    args: [{ name: "name" }],
    extraArgsError: "values are never arguments (shell history and process lists would show them): type them at the prompt, or pipe them in",
    options: {
      type: {
        type: "string",
        choices: ["password", "secret"],
        description: "password (a website sign-in: --username, --origin, a password, optionally a 2FA key) or secret (one value, the default)",
      },
      username: { type: "string", value: "name", description: "A password's user name (not secret: it is shown in the list)" },
      "2fa": { type: "boolean", description: "A password also has a 2FA setup key (same as --code-source totp): it is asked for after the password (second line when piped)" },
      "remove-2fa": { type: "boolean", description: "Take 2FA off a password (whatever its code source)" },
      "code-source": {
        type: "string",
        choices: ["totp", "push", "url"],
        description: "Where a password's 2FA codes come from: totp (an authenticator key, asked for like --2fa), push (you send each code or sign-in link with credentials push-code) or url (the platform asks --code-url)",
      },
      "code-url": { type: "string", value: "url", description: "With --code-source url: the https:// address the platform asks for each code or link (not secret; the signing secret is shown once)" },
      "code-timeout": { type: "string", integer: { min: 5, max: 900 }, value: "seconds", description: "How long a run waits for a pushed or asked code (5 to 900, default 300)" },
      scope: {
        type: "string",
        choices: ["agent", "shell", "all"],
        description: "Where it may be used: agent (the default: only the AI, as placeholders), shell (only as variables in shells), or all",
      },
      origin: { type: "string", multiple: true, value: "site", description: "A site where the AI may type it, e.g. https://example.com (required for a password)" },
      shell: { type: "boolean", description: "Let the AI use it in bash commands (this also allows exporting it into shells)" },
      description: { type: "string", value: "text", description: "What it is for" },
    },
    notes: [
      "Values never go on the command line: type them at the hidden prompt, or pipe them in. A secret's value is taken",
      "whole, less one final line break, so keys of several lines work. A password is the first line, and with --2fa",
      "the 2FA setup key (or an otpauth:// link) is the second. A credential that exists gets the new values; options",
      "you leave out stay as they were, and a new site, or a scope that lets shells read it, needs the values again.",
      "Values are never shown again, by the CLI or the API. A password credential needs a plan with password",
      "credentials (the loginDetails feature).",
      "",
      "The AI uses a secret as %NAME% and a password as %NAME.username%, %NAME.password% and %NAME.otp% (boxline run",
      "--credential NAME). In a shell they are $NAME, or $NAME_USERNAME and $NAME_PASSWORD (scope shell or all).",
      "",
      "Sites that email or text a code: --code-source push, and send each code (or sign-in link) when a run waits for it",
      "(the webhook credential.code_needed says when) with boxline credentials push-code NAME; or --code-source url with",
      "--code-url, an https:// address of yours that the platform asks every 5 seconds while a run waits (signed, like a",
      "webhook). Changing where the codes come from needs the password again, as for any password change.",
    ],
    examples: [
      "boxline credentials set GITHUB_TOKEN --scope shell",
      "boxline credentials set API_KEY --origin https://api.example.com < key.txt",
      "boxline credentials set SHOP --type password --username ops@example.com --origin https://shop.example.com",
      "printf '%s\\n%s\\n' \"$SHOP_PASSWORD\" \"$SHOP_2FA_KEY\" | boxline credentials set SHOP --type password --username ops@example.com --origin https://shop.example.com --2fa",
      "boxline credentials set SHOP --username ops@example.com --origin https://shop.example.com --code-source push",
      "boxline credentials set SHOP --username ops@example.com --origin https://shop.example.com --code-source url --code-url https://ops.example.com/boxline-codes",
    ],
  },
  {
    path: ["credentials", "push-code"],
    summary: "Send the 2FA code or sign-in link a site emailed or texted, to a run waiting for it (read from a hidden prompt or stdin)",
    args: [{ name: "name" }],
    extraArgsError: "a code or link is never an argument (shell history and process lists would show it): type it at the prompt, or pipe it in",
    options: {},
    notes: [
      "For a password with --code-source push. A value that starts with http:// or https:// is a sign-in link (it must be on",
      "one of the credential's sites), anything else is a code. It is used once, by a wait that began before it arrived,",
      "and kept sealed for 10 minutes. The platform never shows it again.",
    ],
    examples: ["printf '%s\\n' \"$CODE\" | boxline credentials push-code SHOP", "boxline credentials push-code SHOP < magic-link.txt"],
  },
  {
    path: ["credentials", "delete"],
    summary: "Delete a credential (profiles that link it are unlinked)",
    args: [{ name: "name" }],
    options: {},
  },

  // ---------------------------------------------------------------- web
  {
    path: ["fetch"],
    summary: "Print a page as Markdown, HTML or text (rendered in a real browser)",
    args: [{ name: "url" }],
    options: {
      format: { type: "string", choices: FORMATS, description: "Output format (default markdown)" },
      proxy: { type: "string", value: "proxy", description: PROXY_HELP },
    },
    examples: ["boxline fetch https://example.com", "boxline fetch https://example.com --format text > page.txt"],
  },
  {
    path: ["search"],
    summary: "Search the web: titles, addresses and snippets (and, with --fetch, the top pages as Markdown)",
    args: [{ name: "query", variadic: true }],
    options: {
      limit: { type: "string", integer: { min: 1, max: 20 }, value: "n", description: "Results, 1 to 20 (default 10)" },
      country: { type: "string", value: "CC", description: "Where the results come from, e.g. DE (default US)" },
      language: { type: "string", value: "lang", description: "The results' language, e.g. de (default en)" },
      recency: { type: "string", choices: ["day", "week", "month", "year"], description: "Only results from the last day, week, month or year" },
      fetch: { type: "string", integer: { min: 0, max: 5 }, value: "n", description: "Also open the top n pages (0 to 5) and print them as Markdown" },
    },
    notes: ['Operators work in the query: "exact words", -word, site:example.com, filetype:pdf. Each search counts against the plan\'s monthly searches; the same search within an hour is free.'],
    examples: ['boxline search "hono routing docs" --limit 5', 'boxline search "site:docs.python.org asyncio" --fetch 2', 'boxline search "zod" --json'],
  },
  {
    path: ["screenshot"],
    summary: "Save a screenshot of a page",
    args: [{ name: "url" }],
    options: {
      output: { type: "string", short: "o", value: "file", description: 'Where to save it (default: <host>.png; "-" for stdout; .jpg saves a JPEG)' },
      "full-page": { type: "boolean", description: "The whole page, not only the first screen" },
      proxy: { type: "string", value: "proxy", description: PROXY_HELP },
    },
    examples: ["boxline screenshot https://example.com", "boxline screenshot https://example.com -o shot.png --full-page"],
  },
  {
    path: ["pdf"],
    summary: "Save a page as a PDF",
    args: [{ name: "url" }],
    options: {
      output: { type: "string", short: "o", value: "file", description: 'Where to save it (default: <host>.pdf; "-" for stdout)' },
      proxy: { type: "string", value: "proxy", description: PROXY_HELP },
    },
    examples: ["boxline pdf https://example.com -o example.pdf"],
  },
  {
    path: ["extract"],
    summary: "Pull structured data out of a page with AI",
    args: [{ name: "url" }],
    options: {
      prompt: { type: "string", value: "text", description: "What to extract" },
      schema: { type: "string", value: "file.json", description: "A JSON Schema file the result must follow" },
      model: { type: "string", value: "id", description: "The model (default: a fast, low-cost one)" },
      proxy: { type: "string", value: "proxy", description: PROXY_HELP },
    },
    notes: ["Give --prompt, --schema or both. The data is printed as JSON on stdout."],
    examples: ['boxline extract https://example.com/pricing --prompt "the plan names and prices"', "boxline extract https://example.com --schema product.json"],
  },
  {
    path: ["crawl"],
    summary: "Follow links from a page and collect what they say",
    args: [{ name: "url" }],
    options: {
      limit: { type: "string", integer: { min: 1, max: 200 }, value: "n", description: "At most this many pages (default 20)" },
      output: { type: "string", short: "o", value: "dir", description: "Save each page as a file in this folder" },
      format: { type: "string", choices: FORMATS, description: "Page format (default markdown)" },
    },
    notes: ["robots.txt is respected. Ctrl+C stops the crawl."],
    examples: ["boxline crawl https://example.com/docs --limit 50 -o docs"],
  },

  // ---------------------------------------------------------------- sessions
  {
    path: ["sessions", "list"],
    summary: "List sessions, newest first",
    args: [],
    options: {
      status: { type: "string", value: "status", description: "Only these: running, stopped, deleted, error (comma-separated)" },
      limit: { type: "string", integer: { min: 1, max: 500 }, value: "n", description: "How many (default 20)" },
      all: { type: "boolean", description: "Every session, page after page" },
    },
  },
  {
    path: ["sessions", "create"],
    summary: "Start a session (a machine with a browser and, if you like, a shell)",
    args: [],
    options: {
      shell: { type: "boolean", description: "Add a bash shell with Python, Node and sudo" },
      "no-browser": { type: "boolean", description: "Shell only, no browser (needs --shell)" },
      proxy: { type: "string", value: "proxy", description: PROXY_HELP },
      timeout: { type: "string", integer: { min: 60 }, value: "seconds", description: "Stop it after this long (default 300)" },
      "idle-timeout": { type: "string", integer: { min: 30 }, value: "seconds", description: "End it after this long without activity (default: never)" },
      captcha: { type: "string", choices: CAPTCHA, description: "When a CAPTCHA appears (default ask)" },
      "keep-alive": { type: "boolean", description: "Keep a browser-only session after the last client leaves" },
    },
    examples: ["boxline sessions create --shell", "boxline sessions create --proxy residential:DE --timeout 900"],
  },
  {
    path: ["sessions", "get"],
    summary: "Show one session",
    args: [{ name: "id" }],
    options: {},
  },
  {
    path: ["sessions", "stop"],
    summary: "Stop a session: save it as it is and free its machine (billing stops)",
    args: [{ name: "id" }],
    options: {},
    notes: [
      "The whole browser (every tab, cookies, storage) and the files are saved. A stopped session is kept for your plan's",
      "days, then deleted; \"boxline sessions resume <id>\" brings it back before that.",
    ],
  },
  {
    path: ["sessions", "resume"],
    summary: "Bring a stopped session back, as it was",
    args: [{ name: "id" }],
    options: {},
  },
  {
    path: ["sessions", "delete"],
    summary: "Delete a session for good, with what it saved, its recording and its logs (cannot be undone)",
    args: [{ name: "id" }],
    options: {},
  },
  {
    path: ["sessions", "login"],
    summary: "Sign a session's browser in with a saved password credential",
    args: [{ name: "id" }, { name: "credential" }],
    options: {
      url: { type: "string", value: "url", description: "The sign-in page, on one of the credential's sites (default: its first site)" },
    },
    notes: [
      "A short AI run in the session types the credential on its sites only; the model never sees the password or any code.",
      "A password with --code-source push or url waits for its code or sign-in link (see boxline credentials set --help).",
      "It counts as an agent run, and needs a plan with password credentials (the loginDetails feature).",
    ],
    examples: ["boxline sessions login <id> SHOP", "boxline sessions login <id> SHOP --url https://shop.example.com/login"],
  },
  {
    path: ["sessions", "live"],
    summary: "Print the session's live view link (watch and act in a browser)",
    args: [{ name: "id" }],
    options: {},
    notes: ["The link works like a password: anyone who has it can watch and control the browser.", "A session without a browser has none. --json prints the live, terminal and connect URLs the session has."],
  },

  // ---------------------------------------------------------------- shell
  {
    path: ["exec"],
    summary: "Run a command in a session's shell and stream its output",
    args: [{ name: "id" }],
    rest: { name: "command", required: true },
    options: {
      cwd: { type: "string", value: "dir", description: "Run it in this folder (default: the workspace)" },
      env: { type: "string", multiple: true, value: "NAME=value", description: "An environment variable for the command" },
      timeout: { type: "string", integer: { min: 1, max: 3600 }, value: "seconds", description: "Stop the command after this long (default 120)" },
    },
    notes: [
      "The words after -- are joined with spaces and run by bash, like ssh. Exits with the command's exit code",
      "(124 when it timed out). Ctrl+C stops it.",
    ],
    examples: ["boxline exec <id> -- ls -la", "boxline exec <id> -- 'python3 -c \"print(2**10)\" | tee out.txt'"],
  },
  {
    path: ["shell"],
    summary: "Open an interactive terminal in a session",
    args: [{ name: "id" }],
    options: {},
    notes: ["Ctrl+D (or exit) leaves; Ctrl+] disconnects at once. The session keeps running."],
  },

  // ---------------------------------------------------------------- files
  {
    path: ["files", "ls"],
    summary: "List files in a session's workspace",
    args: [{ name: "id" }, { name: "path", optional: true }],
    options: {},
  },
  {
    path: ["files", "get"],
    summary: "Download a file, or a whole folder as a .tar.gz, from a session",
    args: [{ name: "id" }, { name: "path" }, { name: "local", optional: true }],
    options: {},
    notes: [
      '[local] defaults to the file name in the current folder; "-" prints it to stdout.',
      "A folder comes down as one .tar.gz (<folder>.tar.gz by default; use . for the whole workspace): everything an agent made, in",
      "one call. It also works on a stopped session, which is read without starting a machine.",
    ],
    examples: ["boxline files get <id> downloads/report.csv", "boxline files get <id> output/total.txt -", "boxline files get <id> results", "boxline files get <id> . workspace.tar.gz"],
  },
  {
    path: ["files", "put"],
    summary: "Upload a file into a session",
    args: [{ name: "id" }, { name: "path" }, { name: "local", optional: true }],
    options: {},
    notes: ['<path> is where it goes in the workspace. [local] defaults to the file of that name here; "-" reads stdin.'],
    examples: ["boxline files put <id> data/input.csv ./input.csv", "echo hello | boxline files put <id> hello.txt -"],
  },
  {
    path: ["files", "rm"],
    summary: "Delete a file in a session",
    args: [{ name: "id" }, { name: "path" }],
    options: {},
  },
];

export const GROUPS = ["sessions", "files", "tasks", "credentials"];

/** The overview `boxline --help` prints. */
export function mainHelp(version: string): string {
  const rows: [string, string][] = [
    ["run <task>", "Give the AI agent a task and watch it work"],
    ["resume <runId>", "Go on with a run that stopped at a limit or was paused"],
    ["message <runId> <text>", "Tell a working run something"],
    ["tasks …", "list, run saved tasks"],
    ["credentials …", "list, set, push-code, delete passwords and secrets"],
    ["search <query>", "Search the web (and fetch the top pages)"],
    ["fetch <url>", "Print a page as Markdown, HTML or text"],
    ["screenshot <url>", "Save a screenshot of a page"],
    ["pdf <url>", "Save a page as a PDF"],
    ["extract <url>", "Pull structured data out of a page with AI"],
    ["crawl <url>", "Follow links and collect the pages"],
    ["sessions …", "list, create, get, stop, resume, delete, login, live"],
    ["exec <id> -- <cmd>", "Run a command in a session's shell"],
    ["shell <id>", "Open an interactive terminal in a session"],
    ["files …", "ls, get, put, rm files in a session"],
    ["usage", "Usage and cost"],
    ["whoami", "The project and plan of your key"],
    ["login / logout", "Save or forget your API key"],
  ];
  const w = Math.max(...rows.map(([c]) => c.length));
  return [
    `boxline ${version}: the infrastructure AI agents need (browsers, shells, storage, isolated machines)`,
    "",
    "Usage: boxline <command> [options]",
    "",
    "Commands:",
    ...rows.map(([c, d]) => `  ${c.padEnd(w)}  ${d}`),
    "",
    "Every command takes --json (output for programs) and --help.",
    "The API key comes from BOXLINE_API_KEY or `boxline login`; BOXLINE_API_URL picks the API.",
    "Docs: https://docs.boxline.dev",
  ].join("\n") + "\n";
}
