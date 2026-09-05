#!/usr/bin/env node
// Invoked by Claude Code's hook system (see ~/.claude/settings.json after
// running `claude-code-rpc install`). Reads the hook JSON payload Claude
// Code sends on stdin, translates it into a small status record, and writes
// it to ~/.claude-code-rpc/sessions/<sessionId>.json for the daemon to pick
// up. This script deliberately has no dependency on how `claude` itself was
// installed (npm, native binary, Homebrew, ...) — Claude Code just runs it
// as `node <this file> <EventName>`, which works identically everywhere
// Node is on PATH.
import path from "node:path";
import { readAllSessions, writeSessionStatus, removeSessionStatus } from "../src/statusStore.js";
import { describeTool } from "../src/toolMeta.js";
import { sessionFile } from "../src/paths.js";
import fs from "node:fs";

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadExisting(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function describeEvent(eventName, payload) {
  switch (eventName) {
    case "SessionStart":
      return { label: "Starting Claude Code", icon: "claude" };
    case "UserPromptSubmit":
      return { label: "Thinking", icon: "think" };
    case "PreToolUse":
    case "PostToolUse": {
      const meta = describeTool(payload.tool_name);
      return { label: meta.label, icon: meta.icon };
    }
    case "SubagentStop":
      return { label: "Subagent finished", icon: "agent" };
    case "PreCompact":
      return { label: "Compacting conversation", icon: "think" };
    case "Notification":
      return { label: payload.message ? "Waiting for approval" : "Idle", icon: "idle" };
    case "Stop":
      return { label: "Waiting for your input", icon: "idle" };
    default:
      return { label: "Working", icon: "think" };
  }
}

async function main() {
  const argvEvent = process.argv[2];
  const raw = await readStdin();
  const payload = safeParse(raw);
  const eventName = payload.hook_event_name || argvEvent || "Unknown";
  const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || "unknown";

  if (eventName === "SessionEnd") {
    removeSessionStatus(sessionId);
    return;
  }

  const cwd = payload.cwd || process.cwd();
  const project = path.basename(cwd) || cwd;
  const existing = loadExisting(sessionId);
  const { label, icon } = describeEvent(eventName, payload);

  writeSessionStatus(sessionId, {
    event: eventName,
    project,
    projectPath: cwd,
    activityLabel: label,
    icon,
    sessionStartedAt: existing?.sessionStartedAt || Date.now(),
  });

  // Best-effort: keep the sessions directory from growing forever if
  // SessionEnd never fires (e.g. the process was killed). Cheap enough to
  // run on every hook invocation since it only touches in-memory-cheap
  // metadata, not the daemon's reconnect logic.
  pruneOrphaned();
}

function pruneOrphaned() {
  const staleAfterMs = 6 * 60 * 60 * 1000; // 6 hours
  const now = Date.now();
  for (const s of readAllSessions()) {
    if (now - s.updatedAt > staleAfterMs) removeSessionStatus(s.sessionId);
  }
}

main();
