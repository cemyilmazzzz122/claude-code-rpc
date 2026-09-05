import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Everything this project persists lives under ~/.claude-code-rpc, kept
// deliberately separate from ~/.claude so it never collides with Claude
// Code's own state and survives a `claude` reinstall/update untouched.
export const HOME = os.homedir();
export const CONFIG_DIR = path.join(HOME, ".claude-code-rpc");
export const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");
export const LATEST_FILE = path.join(CONFIG_DIR, "latest.json");
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
export const LOG_FILE = path.join(CONFIG_DIR, "daemon.log");

export function ensureConfigDirs() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function sessionFile(sessionId) {
  return path.join(SESSIONS_DIR, `${sanitize(sessionId)}.json`);
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}
