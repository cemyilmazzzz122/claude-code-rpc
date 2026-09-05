import fs from "node:fs";
import path from "node:path";
import { SESSIONS_DIR, sessionFile, ensureConfigDirs } from "./paths.js";

// Each running `claude` session gets its own JSON file under
// ~/.claude-code-rpc/sessions/<sessionId>.json, written by the hook script
// on every Claude Code lifecycle event. The daemon never talks to Claude
// Code directly — it only reads this directory, so multiple concurrent
// `claude` sessions (different terminals/projects) don't clobber each
// other, and the daemon just shows whichever one was updated most recently.

export function writeSessionStatus(sessionId, status) {
  ensureConfigDirs();
  const file = sessionFile(sessionId);
  const payload = { ...status, sessionId, updatedAt: Date.now() };
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return payload;
}

export function removeSessionStatus(sessionId) {
  try {
    fs.unlinkSync(sessionFile(sessionId));
  } catch {
    // already gone, fine
  }
}

export function readAllSessions() {
  ensureConfigDirs();
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }
  const sessions = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, name), "utf8");
      sessions.push(JSON.parse(raw));
    } catch {
      // skip unreadable/partially-written file
    }
  }
  return sessions;
}

/**
 * Picks the session to display: the most recently updated one that isn't
 * stale (covers `claude` processes killed without a SessionEnd event).
 */
export function pickActiveSession(staleAfterMs) {
  const sessions = readAllSessions();
  const now = Date.now();
  const alive = sessions.filter((s) => now - s.updatedAt < staleAfterMs);
  if (alive.length === 0) return null;
  alive.sort((a, b) => b.updatedAt - a.updatedAt);
  return alive[0];
}

/** Deletes session files that haven't been touched in a long time. */
export function pruneStaleSessions(staleAfterMs) {
  const sessions = readAllSessions();
  const now = Date.now();
  for (const s of sessions) {
    if (now - s.updatedAt >= staleAfterMs) {
      removeSessionStatus(s.sessionId);
    }
  }
}
