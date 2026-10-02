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
      session: { type: "string", value: "id", description: "Work in this session instead of a new one" },
      model: { type: "string", value: "id", description: "The model, e.g. claude-sonnet-5 or gpt-6-sol (default: the server's)" },
      var: { type: "string", multiple: true, value: "name=value", description: "A value the task uses as %name%" },
      secret: {
        type: "string",
        multiple: true,
        value: "NAME[@site]",
        description: "A secret from the environment variable NAME, used as %NAME% (the model never sees it)",
      },
      captcha: { type: "string", choices: CAPTCHA, description: "When a CAPTCHA appears: ask a person (default), solve it, or ignore it" },
      keep: { type: "boolean", description: "Keep the run's session running afterwards" },
      steps: { type: "string", value: "n|none", description: 'Stop after this many steps, 1 to 1000 (default 30); "none": no step limit' },
      "no-step-limit": { type: "boolean", description: "Same as --steps none: the run goes until it is done or its session's time ends" },
      "max-steps": { type: "string", integer: { min: 1, max: 1000 }, value: "n", description: "Same as --steps n" },
      "max-cost": { type: "string", value: "usd", description: "Stop once the run's model cost reaches this many US dollars (0.01 to 100)" },
      timeout: { type: "string", integer: { min: 60 }, value: "seconds", description: "The run's own session's time (default 1800, or your plan's maximum)" },
    },
    notes: [
      "Steps are shown as they happen (on stderr); the answer is printed on stdout. Ctrl+C stops the run.",
      "While it works, type a line and press Enter to send the agent a message; it reads it at its next step.",
      "Exit code: 0 when the run completed, 1 when it failed or stopped at a limit, 130 when you stopped it.",
      "A run that stops at a limit (steps, cost, errors in a row) keeps its session for 10 minutes:",
      "  boxline continue <runId> carries it on.",
      "",
      "Secrets: set the value in your environment, pass its name. Add @site to allow typing it only there:",
      "  --secret SITE_PASSWORD@https://example.com",
    ],
    examples: [
      'boxline run "Find the price of the cheapest plan on https://example.com/pricing"',
      'boxline run "Download the CSV from https://example.com/report and add up the revenue column" --shell',
      'SITE_PASSWORD=… boxline run "Sign in with %email% and %SITE_PASSWORD%" --var email=ada@example.com --secret SITE_PASSWORD@https://example.com',
      'boxline run "Convert every video in the workspace to MP4" --shell --steps none --max-cost 2 --timeout 3600',
    ],
  },
  {
    path: ["continue"],
    summary: "Carry on an agent run that stopped at a limit, and watch it",
    args: [{ name: "runId" }],
    options: {
      steps: { type: "string", value: "n|none", description: 'Steps for the new run, 1 to 1000 (default: the run\'s own); "none": no step limit' },
      "no-step-limit": { type: "boolean", description: "Same as --steps none" },
      "max-cost": { type: "string", value: "usd", description: "The new run's cost limit in US dollars (default: the run's own)" },
      note: { type: "string", value: "text", description: "An extra note for the agent (at most 2000 characters)" },
      var: { type: "string", multiple: true, value: "name=value", description: "The run's variables again (values are never stored)" },
      secret: { type: "string", multiple: true, value: "NAME", description: "A secret variable again, from the environment variable NAME" },
    },
    notes: [
      "For a run that stopped at its step limit, its cost limit, or after tool errors in a row, within 10 minutes.",
      "The new run works in the same session and knows what the previous one did. Shown like boxline run.",
      "A run that had --var or --secret values needs them again (they keep the sites they had).",
    ],
    examples: ["boxline continue run_Xy12Ab34Cd56Ef78", 'boxline continue run_Xy12Ab34Cd56Ef78 --steps 50 --note "The download is done; do the upload"'],
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

  // ---------------------------------------------------------------- secrets
  {
    path: ["secrets", "list"],
    summary: "List the project's secrets (never their values)",
    args: [],
    options: {
      limit: { type: "string", integer: { min: 1, max: 200 }, value: "n", description: "How many (default 100)" },
      all: { type: "boolean", description: "Every secret, page after page" },
    },
  },
  {
    path: ["secrets", "set"],
    summary: "Create a secret, or give one a new value (read from stdin or a hidden prompt)",
    args: [{ name: "name" }],
    extraArgsError: "the value is never an argument (shell history and process lists would show it): type it at the prompt, or pipe it in",
    options: {
      scope: {
        type: "string",
        choices: ["agent", "shell", "all"],
        description: "Where it may be used: agent (the default: only the AI, as %NAME%), shell (only as $NAME in shells), or all",
      },
      origin: { type: "string", multiple: true, value: "site", description: "A site where the AI may type it, e.g. https://example.com (recommended for passwords)" },
      shell: { type: "boolean", description: "Let the AI use it in bash commands (this also allows exporting it into shells)" },
      description: { type: "string", value: "text", description: "What it is for" },
    },
    notes: [
      "The value never goes on the command line: type it at the hidden prompt, or pipe it in (taken whole, less one",
      "final line break, so keys of several lines work). A secret that exists gets the new value; options you leave",
      "out stay as they were. The value is never shown again, by the CLI or the API.",
    ],
    examples: ["boxline secrets set GITHUB_TOKEN --scope shell", "boxline secrets set SITE_PASSWORD --origin https://example.com < password.txt"],
  },
  {
    path: ["secrets", "delete"],
    summary: "Delete a secret",
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
      status: { type: "string", value: "status", description: "Only these: running, paused, completed, error (comma-separated)" },
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
    path: ["sessions", "release"],
    summary: "Stop a session and delete its machine",
    args: [{ name: "id" }],
    options: {},
  },
  {
    path: ["sessions", "live"],
    summary: "Print the session's live view link (watch and take over in a browser)",
    args: [{ name: "id" }],
    options: {},
    notes: ["The link works like a password: anyone who has it can watch and control the browser."],
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
    summary: "Download a file from a session",
    args: [{ name: "id" }, { name: "path" }, { name: "local", optional: true }],
    options: {},
    notes: ['[local] defaults to the file name in the current folder; "-" prints it to stdout.'],
    examples: ["boxline files get <id> downloads/report.csv", "boxline files get <id> output/total.txt -"],
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

export const GROUPS = ["sessions", "files", "tasks", "secrets"];

/** The overview `boxline --help` prints. */
export function mainHelp(version: string): string {
  const rows: [string, string][] = [
    ["run <task>", "Give the AI agent a task and watch it work"],
    ["continue <runId>", "Carry on a run that stopped at a limit"],
    ["message <runId> <text>", "Tell a working run something"],
    ["tasks …", "list, run saved tasks"],
    ["secrets …", "list, set, delete project secrets"],
    ["search <query>", "Search the web (and fetch the top pages)"],
    ["fetch <url>", "Print a page as Markdown, HTML or text"],
    ["screenshot <url>", "Save a screenshot of a page"],
    ["pdf <url>", "Save a page as a PDF"],
    ["extract <url>", "Pull structured data out of a page with AI"],
    ["crawl <url>", "Follow links and collect the pages"],
    ["sessions …", "list, create, get, release, live"],
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
