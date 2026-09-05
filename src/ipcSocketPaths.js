import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Discord's local RPC socket lives at `<dir>/discord-ipc-<0-9>`. On a plain
// desktop install `<dir>` is $XDG_RUNTIME_DIR (Linux) or $TMPDIR (macOS).
// But Discord/Vencord clients installed via Flatpak or Snap run in a
// sandbox and expose the socket under a per-app subdirectory instead, so a
// naive single-path check misses them entirely. We enumerate every
// plausible location and let the caller try them in order until one
// connects — this is what makes the daemon indifferent to whether Discord
// was installed from a distro package, Flatpak, Snap, or is Vesktop/Canary/
// PTB, and it costs nothing extra on macOS where none of these exist.

// Known Flatpak application IDs for Discord clients / mods that speak the
// same RPC protocol.
const FLATPAK_APP_IDS = [
  "com.discordapp.Discord",
  "com.discordapp.DiscordCanary",
  "com.discordapp.DiscordPTB",
  "dev.vencord.Vesktop",
  "dev.vencord.VesktopPTB",
  "io.github.spacingbat3.webcord",
  "io.github.spacingbat3.webcord.canary",
  "com.github.Bnyro.Vesktop",
];

// Known Snap instance names.
const SNAP_NAMES = ["discord", "discord-canary", "discord-ptb"];

function baseRuntimeDirs() {
  const dirs = [];
  if (process.env.XDG_RUNTIME_DIR) dirs.push(process.env.XDG_RUNTIME_DIR);
  if (process.env.TMPDIR) dirs.push(process.env.TMPDIR);
  if (process.env.TMP) dirs.push(process.env.TMP);
  if (process.env.TEMP) dirs.push(process.env.TEMP);
  if (typeof process.getuid === "function") {
    dirs.push(`/run/user/${process.getuid()}`);
  }
  dirs.push(os.tmpdir());
  dirs.push("/tmp");
  return [...new Set(dirs.filter(Boolean))];
}

function expandDir(baseDir) {
  const dirs = [baseDir];
  for (const appId of FLATPAK_APP_IDS) {
    // The portal-shared per-app dir. Only populated if the app was granted
    // (or itself requests) access to it — not guaranteed.
    dirs.push(path.join(baseDir, "app", appId));
    // Flatpak's own private backing store for that app's sandboxed view of
    // $XDG_RUNTIME_DIR. This exists for *every* Flatpak app regardless of
    // any filesystem permission grant — sandboxed apps (Vesktop included)
    // write their RPC listen socket into their own private
    // $XDG_RUNTIME_DIR, and Flatpak transparently backs that with this
    // host-side path. Checking it means zero configuration is needed on
    // the user's end, no matter how the Discord client was installed.
    dirs.push(path.join(baseDir, ".flatpak", appId, "xdg-run"));
  }
  for (const snap of SNAP_NAMES) {
    dirs.push(path.join(baseDir, `snap.${snap}`));
  }
  return dirs;
}

/**
 * Returns an ordered list of candidate Unix socket paths to try.
 * Windows uses named pipes instead and is handled separately by the caller.
 */
export function candidateSocketPaths() {
  const dirs = baseRuntimeDirs().flatMap(expandDir);
  const uniqueDirs = [...new Set(dirs)];

  const paths = [];
  for (const dir of uniqueDirs) {
    for (let i = 0; i < 10; i++) {
      paths.push(path.join(dir, `discord-ipc-${i}`));
    }
  }
  return paths;
}

/** Filters candidates down to ones that currently exist on disk (fast pre-check). */
export function existingCandidateSocketPaths() {
  return candidateSocketPaths().filter((p) => {
    try {
      fs.statSync(p);
      return true;
    } catch {
      return false;
    }
  });
}

export function windowsPipeCandidates() {
  const paths = [];
  for (let i = 0; i < 10; i++) {
    paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
  }
  return paths;
}
