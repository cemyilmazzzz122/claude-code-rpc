import fs from "node:fs";
import { DiscordIpcClient } from "./discordIpcClient.js";
import { buildActivity } from "./presence.js";
import { pickActiveSession, pruneStaleSessions } from "./statusStore.js";
import { ensureConfigDirs, SESSIONS_DIR, ENV_FILE } from "./paths.js";
import { getConfig } from "./env.js";

const RECONNECT_DELAY_MS = 10_000;
const RECONCILE_INTERVAL_MS = 20_000;
const WATCH_DEBOUNCE_MS = 500;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

export async function runDaemon() {
  ensureConfigDirs();
  const config = getConfig(ENV_FILE);

  if (!config.clientId) {
    console.error(
      [
        "DISCORD_CLIENT_ID is not set.",
        `Create ${ENV_FILE} with:`,
        "  DISCORD_CLIENT_ID=your_discord_application_id",
        "See the README for how to create a Discord application.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const client = new DiscordIpcClient(config.clientId, (state, info) => {
    if (state === "connected") {
      log("Connected to Discord over", info?.socketPath ?? "IPC");
      reconcile();
    } else if (state === "disconnected") {
      log("Disconnected from Discord, will retry...");
      scheduleReconnect();
    } else if (state === "error") {
      log("Discord reported an error:", info);
    }
  });

  let lastSentKey = null;

  function reconcile() {
    if (!client.ready) return;
    pruneStaleSessions(config.staleAfterMs);
    const active = pickActiveSession(config.staleAfterMs);
    const activity = buildActivity(active);
    const key = activity ? JSON.stringify(activity) : null;
    if (key === lastSentKey) return;
    lastSentKey = key;

    if (activity) {
      client.setActivity(activity);
      log(`Presence -> ${activity.details} (${activity.state})`);
    } else {
      client.clearActivity();
      log("Presence -> cleared (no active session)");
    }
  }

  let reconnectTimer = null;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await client.connect();
      } catch {
        log("Discord not reachable yet (is it running?), retrying in", RECONNECT_DELAY_MS / 1000, "s");
        scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  try {
    await client.connect();
  } catch {
    log("Discord not reachable yet (is it running?), retrying in", RECONNECT_DELAY_MS / 1000, "s");
    scheduleReconnect();
  }

  let debounceTimer = null;
  try {
    fs.watch(SESSIONS_DIR, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(reconcile, WATCH_DEBOUNCE_MS);
    });
  } catch (err) {
    log("Could not watch sessions directory, falling back to polling only:", err.message);
  }

  setInterval(reconcile, RECONCILE_INTERVAL_MS);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  function shutdown() {
    log("Shutting down, clearing presence...");
    client.clearActivity();
    setTimeout(() => process.exit(0), 200);
  }

  log("claude-code-rpc daemon started. Watching", SESSIONS_DIR);
}
