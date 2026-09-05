import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HOOK_SCRIPT = path.resolve(__dirname, "..", "hooks", "claude-rpc-hook.mjs");
export const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), ".claude", "settings.json");

// Events we hook into, and whether they're tool-scoped (need a matcher).
const EVENTS = [
  { name: "SessionStart", scoped: false },
  { name: "UserPromptSubmit", scoped: false },
  { name: "PreToolUse", scoped: true },
  { name: "PostToolUse", scoped: true },
  { name: "Notification", scoped: false },
  { name: "PreCompact", scoped: false },
  { name: "SubagentStop", scoped: false },
  { name: "Stop", scoped: false },
  { name: "SessionEnd", scoped: false },
];

function hookCommand(eventName) {
  // Quoting handles paths with spaces (common on macOS, e.g. "Application
  // Support"); `node` on PATH means this works regardless of how Claude
  // Code itself was installed.
  return `node "${HOOK_SCRIPT}" ${eventName}`;
}

function readSettings() {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`Could not parse ${CLAUDE_SETTINGS_FILE}: ${err.message}`);
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}

function backupSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return null;
  const backupPath = `${CLAUDE_SETTINGS_FILE}.bak-${Date.now()}`;
  fs.copyFileSync(CLAUDE_SETTINGS_FILE, backupPath);
  return backupPath;
}

export function installHooks() {
  const settings = readSettings();
  const backupPath = backupSettings();
  settings.hooks = settings.hooks || {};

  let added = 0;
  for (const { name, scoped } of EVENTS) {
    settings.hooks[name] = settings.hooks[name] || [];
    const alreadyInstalled = settings.hooks[name].some((entry) =>
      (entry.hooks || []).some((h) => h.command && h.command.includes("claude-rpc-hook.mjs"))
    );
    if (alreadyInstalled) continue;

    const entry = { hooks: [{ type: "command", command: hookCommand(name) }] };
    if (scoped) entry.matcher = "*";
    settings.hooks[name].push(entry);
    added++;
  }

  writeSettings(settings);
  return { added, backupPath, settingsFile: CLAUDE_SETTINGS_FILE };
}

export function uninstallHooks() {
  const settings = readSettings();
  if (!settings.hooks) return { removed: 0 };

  const backupPath = backupSettings();
  let removed = 0;
  for (const { name } of EVENTS) {
    if (!settings.hooks[name]) continue;
    const before = settings.hooks[name].length;
    settings.hooks[name] = settings.hooks[name].filter(
      (entry) => !(entry.hooks || []).some((h) => h.command && h.command.includes("claude-rpc-hook.mjs"))
    );
    removed += before - settings.hooks[name].length;
    if (settings.hooks[name].length === 0) delete settings.hooks[name];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeSettings(settings);
  return { removed, backupPath, settingsFile: CLAUDE_SETTINGS_FILE };
}
