#!/usr/bin/env node
import { runDaemon } from "../src/daemon.js";
import { installHooks, uninstallHooks } from "../src/hooksInstaller.js";
import { pickActiveSession, readAllSessions } from "../src/statusStore.js";
import { ENV_FILE, CONFIG_DIR } from "../src/paths.js";
import fs from "node:fs";

const command = process.argv[2] || "start";

switch (command) {
  case "start":
    await runDaemon();
    break;

  case "install": {
    const result = installHooks();
    console.log(`Updated ${result.settingsFile}`);
    if (result.backupPath) console.log(`Backup saved to ${result.backupPath}`);
    console.log(`Installed ${result.added} new hook(s) (already-installed ones were left untouched).`);
    if (!fs.existsSync(ENV_FILE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(
        ENV_FILE,
        "# Get this from https://discord.com/developers/applications\nDISCORD_CLIENT_ID=\n"
      );
      console.log(`Created ${ENV_FILE} — fill in DISCORD_CLIENT_ID before starting the daemon.`);
    }
    break;
  }

  case "uninstall": {
    const result = uninstallHooks();
    console.log(`Removed ${result.removed} hook(s) from ${result.settingsFile}`);
    if (result.backupPath) console.log(`Backup saved to ${result.backupPath}`);
    break;
  }

  case "status": {
    const sessions = readAllSessions();
    if (sessions.length === 0) {
      console.log("No known Claude Code sessions.");
      break;
    }
    const active = pickActiveSession(15 * 60 * 1000);
    for (const s of sessions.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const marker = active && active.sessionId === s.sessionId ? "*" : " ";
      console.log(
        `${marker} ${s.project}  —  ${s.activityLabel}  (updated ${new Date(s.updatedAt).toLocaleTimeString()})`
      );
    }
    break;
  }

  default:
    console.log(`Usage: claude-code-rpc <start|install|uninstall|status>

  start      Run the Discord presence daemon (keep this running in the background).
  install    Register Claude Code hooks in ~/.claude/settings.json.
  uninstall  Remove those hooks again.
  status     Show currently known Claude Code sessions.`);
    process.exitCode = command === "help" ? 0 : 1;
}
