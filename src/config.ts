/**
 * Where the API key lives. `boxline login` saves it in the user's config folder, in a file only they can read
 * (mode 600, in a folder with mode 700); BOXLINE_API_KEY wins over it. The key is never printed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./output.js";

export const DEFAULT_API_URL = "https://api.boxline.dev";

type Env = Record<string, string | undefined>;

export interface SavedConfig {
  apiKey?: string;
  /** The API the saved key belongs to, when it is not the default one. */
  apiUrl?: string;
}

export interface Credentials {
  apiKey: string | undefined;
  apiUrl: string;
  /** Where the key came from, for `whoami` (never the key itself). */
  source: "env" | "config" | "none";
  /** Set when a saved key exists but belongs to another API than BOXLINE_API_URL (it is then not used). */
  savedFor?: string;
}

/**
 * The OS's config folder for boxline: BOXLINE_CONFIG_DIR, else %APPDATA%\boxline on Windows,
 * ~/Library/Application Support/boxline on macOS, $XDG_CONFIG_HOME/boxline or ~/.config/boxline elsewhere.
 */
export function configDir(env: Env = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (env.BOXLINE_CONFIG_DIR) return env.BOXLINE_CONFIG_DIR;
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "boxline");
  if (platform === "darwin") return join(home, "Library", "Application Support", "boxline");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "boxline");
}

export const configPath = (env: Env = process.env) => join(configDir(env), "config.json");

export function readConfig(env: Env = process.env): SavedConfig {
  const file = configPath(env);
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SavedConfig;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    throw new CliError(`${file} is not valid JSON; run "boxline logout" and log in again`);
  }
}

/** True when others than the owner can read the file (POSIX only): the CLI warns about it. */
export function tooOpen(env: Env = process.env): boolean {
  if (process.platform === "win32") return false;
  try {
    return (statSync(configPath(env)).mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

/** Writes the config atomically with mode 600 (folder 700), so the key is never readable by other users. */
export function writeConfig(config: SavedConfig, env: Env = process.env): string {
  const dir = configDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath(env);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // The mode given to writeFileSync is masked by the umask, and ignored for a file that exists: set it outright.
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}

/** Removes the saved key; returns the file it removed, or null when there was none. */
export function removeConfig(env: Env = process.env): string | null {
  const file = configPath(env);
  if (!existsSync(file)) return null;
  rmSync(file, { force: true });
  return file;
}

const trimUrl = (u: string) => u.replace(/\/+$/, "");

/**
 * The key and API to use. A key from BOXLINE_API_KEY goes to BOXLINE_API_URL or the default API. A saved key only ever
 * goes to the API it was saved for: when BOXLINE_API_URL points somewhere else, the saved key is not used (anyone who
 * can set that variable could otherwise collect it), and the caller is told to log in there or set BOXLINE_API_KEY.
 */
export function resolveCredentials(env: Env = process.env, saved: SavedConfig = readConfig(env)): Credentials {
  const envKey = env.BOXLINE_API_KEY?.trim();
  const envUrl = env.BOXLINE_API_URL?.trim();
  if (envKey) return { apiKey: envKey, apiUrl: trimUrl(envUrl || DEFAULT_API_URL), source: "env" };
  if (saved.apiKey) {
    const savedUrl = trimUrl(saved.apiUrl || DEFAULT_API_URL);
    if (envUrl && trimUrl(envUrl) !== savedUrl) return { apiKey: undefined, apiUrl: trimUrl(envUrl), source: "none", savedFor: savedUrl };
    return { apiKey: saved.apiKey, apiUrl: savedUrl, source: "config" };
  }
  return { apiKey: undefined, apiUrl: trimUrl(envUrl || DEFAULT_API_URL), source: "none" };
}

/** Accepts only http(s) URLs for --api-url and BOXLINE_API_URL. */
export function checkApiUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CliError(`"${url}" is not a URL (for example https://api.boxline.dev)`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new CliError(`the API URL must start with https:// (or http:// for a local API)`);
  return trimUrl(u.toString());
}
