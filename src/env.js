import fs from "node:fs";

// Tiny dependency-free .env reader. We don't rely on `node --env-file`
// because the daemon may be launched by systemd/launchd, where flags are
// easy to forget — reading the file ourselves makes it work no matter how
// the process is started.
export function loadEnvFile(filePath) {
  const result = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function getConfig(envFilePath) {
  const fileEnv = loadEnvFile(envFilePath);
  return {
    clientId: process.env.DISCORD_CLIENT_ID || fileEnv.DISCORD_CLIENT_ID || "",
    updateIntervalMs: Number(
      process.env.RPC_UPDATE_INTERVAL_MS || fileEnv.RPC_UPDATE_INTERVAL_MS || 15000
    ),
    staleAfterMs: Number(
      process.env.RPC_STALE_AFTER_MS || fileEnv.RPC_STALE_AFTER_MS || 15 * 60 * 1000
    ),
  };
}
