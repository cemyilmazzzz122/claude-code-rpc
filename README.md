# claude-code-rpc

Discord Rich Presence for [Claude Code](https://claude.com/claude-code) — like
the official VS Code Discord presence extension, but for your terminal AI
agent. While `claude` is running, your Discord status shows which project
you're in and what Claude Code is currently doing (editing files, running a
command, thinking, waiting for your input, ...), updated live, with an
elapsed-time counter.

```
Claude Code
Editing code
in claude-code-rpc
00:04:12 elapsed
```

This has been tested end-to-end on Linux with Discord running as a Flatpak
(Vesktop), including through a SOCKS5/Tor proxy — see
[How Discord discovery works](#how-discord-discovery-works) for why none of
that matters to this project.

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Step 1 — Create a Discord application](#step-1--create-a-discord-application)
- [Step 2 — Get the code](#step-2--get-the-code)
- [Step 3 — Register the Claude Code hooks](#step-3--register-the-claude-code-hooks)
- [Step 4 — Configure the client ID](#step-4--configure-the-client-id)
- [Step 5 — Run the daemon](#step-5--run-the-daemon)
- [Step 6 — Verify it actually works](#step-6--verify-it-actually-works)
- [Step 7 — Run it automatically in the background](#step-7--run-it-automatically-in-the-background)
  - [Linux — systemd user service](#linux--systemd-user-service)
  - [macOS — launchd agent](#macos--launchd-agent)
- [How Discord discovery works](#how-discord-discovery-works)
- [CLI reference](#cli-reference)
- [What shows up on Discord](#what-shows-up-on-discord)
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Uninstalling](#uninstalling)
- [Design notes](#design-notes)
- [Privacy](#privacy)
- [License](#license)

## How it works

Claude Code has a [hooks](https://docs.claude.com/en/docs/claude-code/hooks)
system that runs a shell command on lifecycle events (a new session
starting, a tool being used, the agent stopping to wait for you, ...). This
project uses that instead of guessing at Claude Code's state from the
outside:

```
 claude (any session, any terminal)
       │  fires a hook event (SessionStart, PreToolUse, Stop, ...)
       ▼
 hooks/claude-rpc-hook.mjs
       │  writes/updates one small JSON file per session
       ▼
 ~/.claude-code-rpc/sessions/<session-id>.json
       │  watched by
       ▼
 the daemon (claude-code-rpc start)
       │  picks the most recently active session, builds a
       │  Rich Presence payload, sends it over Discord's local
       │  IPC socket (no network calls, no Discord API key)
       ▼
 your Discord client → shows up in your status
```

Because state is just files on disk, multiple `claude` sessions running in
different terminals/projects don't interfere with each other, and the
daemon can be started, stopped, or restarted independently of any running
`claude` process.

No network calls, no telemetry, nothing sent anywhere except your own local
Discord client over its local IPC socket. The daemon and the hook script
never talk to Anthropic's servers or read your conversation content — only
the small amount of metadata Claude Code's hooks already expose (the
project directory's name, the event name, the tool name).

**Zero runtime dependencies.** This project implements the small pieces of
the Discord RPC protocol and Claude Code hook wire format it needs directly
in plain Node.js (see [Design notes](#design-notes)) — there's no
`npm install` step and nothing to audit beyond this repo's own code.

## Requirements

- **Node.js 18 or newer**, on `PATH`, on both the machine running Claude
  Code and the one running Discord (normally the same machine).
- **Claude Code CLI** — any install method (npm global install, native
  installer, Homebrew, ...). This project does not care how `claude` got
  onto your system; hooks are just shell commands.
- **A Discord desktop client running locally** — official Discord (native
  package, Flatpak, or Snap), or a client mod that keeps Discord's RPC
  server such as Vesktop/Vencord, BetterDiscord, or WebCord. Discord's
  *web* app (discord.com in a browser) does **not** expose a local RPC
  socket and will not work.
- A free Discord "application" registration to get a Client ID (next
  section) — this does **not** require your own bot, server, or any
  approval process; it's just how Discord scopes a Rich Presence identity.

## Step 1 — Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   in a browser, logged in with the same account your Discord client uses.
2. Click **New Application** (top right), give it a name — e.g. "Claude
   Code" — and accept the terms. The name isn't shown in your status; only
   the text/images configured below are.
3. On the **General Information** page, find **APPLICATION ID** near the
   top and copy it. This is your `DISCORD_CLIENT_ID` — save it somewhere,
   you'll need it in Step 4.
4. *(Optional but recommended)* Open **Rich Presence → Art Assets** in the
   left sidebar and upload images for the keys below. Without this, Rich
   Presence still works — you'll just see no small status icon.

   | Asset key | Suggested image |
   |---|---|
   | `claude` | Claude Code / Anthropic logo (shown as the large image) |
   | `edit` | pencil / editing icon |
   | `terminal` | terminal/console icon |
   | `read` | open book / eye icon |
   | `search` | magnifying glass |
   | `agent` | robot / subagent icon |
   | `think` | thought bubble / hourglass |
   | `idle` | moon / pause icon |

   Image requirements: PNG or JPG, at least 512×512, under 256 KB. Discord
   can take a few minutes to propagate newly uploaded assets.

## Step 2 — Get the code

Clone this repository anywhere you like. `~/claude-code-rpc` is used as the
example path throughout this README (the systemd/launchd templates in
[Step 7](#step-7--run-it-automatically-in-the-background) assume it, so
using that exact path saves you an edit later — otherwise just substitute
your own path).

```bash
git clone <this-repo-url> ~/claude-code-rpc
cd ~/claude-code-rpc
```

There is no `npm install` step — this project has zero runtime
dependencies by design.

Verify your Node.js version:

```bash
node -v   # must print v18.x or higher
```

## Step 3 — Register the Claude Code hooks

This is a one-time step (per machine) that tells Claude Code to call this
project's hook script on every relevant lifecycle event.

```bash
node bin/claude-code-rpc.js install
```

Expected output:

```
Updated /home/you/.claude/settings.json
Backup saved to /home/you/.claude/settings.json.bak-<timestamp>
Installed 9 new hook(s) (already-installed ones were left untouched).
Created /home/you/.claude-code-rpc/.env — fill in DISCORD_CLIENT_ID before starting the daemon.
```

What this actually does, so nothing is a surprise:

- It reads `~/.claude/settings.json` (Claude Code's own global config),
  makes a timestamped backup of it (`.bak-<timestamp>`) if it already
  existed, then merges in nine hook entries — one each for
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `Notification`, `PreCompact`, `SubagentStop`, `Stop`, `SessionEnd`.
  Every entry just runs `node "<absolute path to>/hooks/claude-rpc-hook.mjs" <EventName>`.
- It never touches hooks you've already configured for anything else — it
  only appends its own entries, and detects (by checking for
  `claude-rpc-hook.mjs` in the command string) whether it already
  installed itself, so re-running `install` is always safe and won't
  create duplicates.
- It creates `~/.claude-code-rpc/.env` from a template if that file
  doesn't already exist. This directory (`~/.claude-code-rpc/`) is where
  all of this project's local state lives — config, per-session status
  files, logs — kept separate from `~/.claude` on purpose so it never
  collides with Claude Code's own files.

You can inspect the result yourself:

```bash
cat ~/.claude/settings.json   # look for the "hooks" key
```

## Step 4 — Configure the client ID

Open `~/.claude-code-rpc/.env` in an editor and set the value you copied in
Step 1:

```
DISCORD_CLIENT_ID=1234567890123456789
```

(That's a placeholder — use your own application's numeric ID, typically
17–19 digits.)

## Step 5 — Run the daemon

With Discord (or Vesktop/WebCord/etc.) already open and logged in, start
the daemon in the foreground first, so you can see what it's doing:

```bash
node bin/claude-code-rpc.js start
```

You should see:

```
[...] Connected to Discord over /run/user/1000/discord-ipc-0
[...] claude-code-rpc daemon started. Watching /home/you/.claude-code-rpc/sessions
```

(The exact socket path printed depends on how Discord is installed — see
[How Discord discovery works](#how-discord-discovery-works).)

If Discord isn't reachable yet, you'll instead see it retry every 10
seconds:

```
[...] Discord not reachable yet (is it running?), retrying in 10 s
```

This is expected if Discord hasn't finished starting, or isn't running at
all — the daemon keeps polling and will connect automatically the moment
it becomes reachable, so it's safe to start the daemon before Discord.

Leave it running, then in **another terminal**, start a Claude Code
session in some project and ask it to do something (read a file, run a
command, anything). Watch the daemon's terminal — you should see log lines
like:

```
[...] Presence -> Editing code (in my-project)
```

...and your Discord status should update within a second or two.

Press `Ctrl+C` to stop the daemon; it clears your Rich Presence on the way
out rather than leaving a stale status behind.

## Step 6 — Verify it actually works

Two independent checks:

1. **From the daemon's point of view** — in the project directory, run:

   ```bash
   node bin/claude-code-rpc.js status
   ```

   This lists every Claude Code session the daemon currently knows about,
   marking the one being shown on Discord with `*`:

   ```
   * my-project  —  Editing code  (updated 15:04:12)
     other-project  —  Waiting for your input  (updated 14:51:03)
   ```

2. **From Discord's point of view** — open your own user profile card in
   Discord/Vesktop (click your avatar/username) while a `claude` session
   is active. You should see an activity card showing "Claude Code",
   the current status text, and the elapsed timer. Other people who can
   see your Discord status (friends, shared servers) will see the same
   thing on their end — Rich Presence is not limited to your own client.

If step 1 shows the right session but step 2 shows nothing, the problem is
specifically in the Discord IPC connection — see
[Troubleshooting](#troubleshooting).

## Step 7 — Run it automatically in the background

Once you've confirmed it works, set it up to start automatically instead of
running it in a foreground terminal forever.

### Linux — systemd user service

```bash
mkdir -p ~/.config/systemd/user
cp systemd/claude-code-rpc.service ~/.config/systemd/user/
```

Open `~/.config/systemd/user/claude-code-rpc.service` and check the
`ExecStart` line — it defaults to `%h/claude-code-rpc/bin/claude-code-rpc.js`
(`%h` = your home directory). If you cloned to a different path in Step 2,
edit this line to match.

```bash
systemctl --user daemon-reload
systemctl --user enable --now claude-code-rpc.service
```

Check it's running and view logs:

```bash
systemctl --user status claude-code-rpc.service
journalctl --user -u claude-code-rpc.service -f
```

Since this is a *user* service, it starts when you log into your desktop
session, after Discord has had a chance to start too — if it starts before
Discord is ready, that's fine, it just retries (see Step 5).

To stop autostart later:

```bash
systemctl --user disable --now claude-code-rpc.service
```

### macOS — launchd agent

```bash
mkdir -p ~/Library/LaunchAgents
cp launchd/com.claudecoderpc.plist ~/Library/LaunchAgents/
```

Edit `~/Library/LaunchAgents/com.claudecoderpc.plist` and fix three
placeholder paths:

1. The `node` binary path — find yours with `which node` (Homebrew installs
   are typically `/opt/homebrew/bin/node` on Apple Silicon or
   `/usr/local/bin/node` on Intel; nvm installs vary per Node version).
2. The absolute path to this repo's `bin/claude-code-rpc.js`.
3. The two log paths (`StandardOutPath` / `StandardErrorPath`) — replace
   `YOUR_USERNAME` with your actual username, or point them anywhere
   writable.

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.claudecoderpc.plist
```

Check logs:

```bash
tail -f ~/.claude-code-rpc/daemon.out.log ~/.claude-code-rpc/daemon.err.log
```

To stop autostart later:

```bash
launchctl unload ~/Library/LaunchAgents/com.claudecoderpc.plist
```

## How Discord discovery works

Discord's Rich Presence protocol runs entirely over a local Unix domain
socket named `discord-ipc-<0-9>` — no HTTP, no API key, no network access
at all. The hard part is that *where* that socket lives depends entirely
on how Discord itself was packaged, and this project handles every case it
knows about automatically (`src/ipcSocketPaths.js`):

| Install method | Socket location searched |
|---|---|
| Native/distro package (Linux) | `$XDG_RUNTIME_DIR/discord-ipc-<0-9>` |
| Native install (macOS) | `$TMPDIR/discord-ipc-<0-9>` |
| Flatpak (Discord, Discord Canary/PTB, Vesktop, WebCord, ...) | the Flatpak portal's shared per-app dir *and* Flatpak's own private per-app runtime backing store — both checked, no permission grant or `flatpak override` needed |
| Snap | `$XDG_RUNTIME_DIR/snap.discord[-canary\|-ptb]/discord-ipc-<0-9>` |

The daemon tries every candidate path, for sockets `0` through `9` (a
machine can have more than one thing implementing this protocol), in
order, and connects to whichever one answers. This is also why a proxy
configured for Discord's own network traffic (e.g. routing Discord through
Tor/SOCKS5, as in the original motivating setup for this project) has no
effect either way — Rich Presence never leaves your machine.

If you're curious what the daemon actually found, its log line on connect
says exactly which path it used:

```
[...] Connected to Discord over /run/user/1000/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-0
```

## CLI reference

Run from the repo root (`node bin/claude-code-rpc.js <command>`), or add
`~/claude-code-rpc/bin` to your `PATH` for a bare `claude-code-rpc`
command:

| Command | What it does |
|---|---|
| `start` | Runs the presence daemon in the foreground. Connects to Discord, watches `~/.claude-code-rpc/sessions/`, keeps retrying/reconnecting on its own. |
| `install` | Registers the Claude Code hooks in `~/.claude/settings.json` (backs up the file first) and scaffolds `~/.claude-code-rpc/.env`. Safe to re-run. |
| `uninstall` | Removes exactly the hook entries this project added, nothing else. Backs up the file first. |
| `status` | Lists every Claude Code session the daemon currently knows about and which one is being shown on Discord. Doesn't require the daemon to be running — it just reads the same files the daemon would. |

## What shows up on Discord

| Claude Code event | Status shown |
|---|---|
| Session starting | "Starting Claude Code" |
| You submit a prompt | "Thinking" |
| Claude reads a file | "Reading files" |
| Claude edits/writes a file | "Editing code" |
| Claude runs a shell command | "Running a command" |
| Claude searches (grep/glob/web) | "Searching code" / "Searching the web" |
| Claude runs a subagent | "Running a subagent" |
| Claude asks for permission | "Waiting for approval" |
| Claude is done and waiting on you | "Waiting for your input" |
| No active session for a while | Presence is cleared entirely |

The project name shown (`state: "in <project>"`) is the current working
directory's folder name at the time each hook fires. If several `claude`
sessions are running at once (different terminals/tabs/projects), the
daemon shows whichever one had the most recent activity — it's a single
Discord status, so it can't show more than one session at a time. A
session that goes quiet for 15 minutes (configurable, see below) is
treated as dead and dropped automatically, so a force-closed terminal or a
crashed `claude` process won't leave a stale status stuck on your profile
forever.

## Configuration reference

All configuration lives in `~/.claude-code-rpc/.env` (created by `install`,
or copy `.env.example` yourself):

```bash
# Required.
DISCORD_CLIENT_ID=1234567890123456789

# Optional — how often the daemon re-checks state even without a filesystem
# event (a safety net on top of the real-time file watcher). Milliseconds.
RPC_UPDATE_INTERVAL_MS=15000

# Optional — how long a session can go without an update before it's
# considered dead and its status is cleared. Milliseconds.
RPC_STALE_AFTER_MS=900000
```

Environment variables of the same name (e.g. set by systemd/launchd, or
exported in your shell) take priority over the `.env` file.

## Troubleshooting

**"DISCORD_CLIENT_ID is not set"** — you haven't completed
[Step 4](#step-4--configure-the-client-id), or `~/.claude-code-rpc/.env`
doesn't parse (check for stray quotes/spaces around `=`).

**Daemon keeps printing "Discord not reachable yet"** —

1. Confirm Discord (or your client of choice) is actually running and
   fully started (past the loading screen), not just launching.
2. Confirm it's a *desktop* client, not discord.com in a browser tab.
3. As a sanity check, search for the socket by hand:
   ```bash
   find /run/user/$(id -u) /tmp "$TMPDIR" -maxdepth 4 -iname 'discord-ipc-*' 2>/dev/null
   ```
   (On macOS, drop the `/run/user` path — it's Linux-only.) If nothing
   turns up at all, the client either isn't running or is a variant this
   project's search list (`src/ipcSocketPaths.js`) doesn't know about yet
   — file an issue with the exact client/package you're using.
4. If you found a socket above but the daemon still doesn't connect, make
   sure you're running the daemon as the *same user* that's running
   Discord — socket permissions are per-user.

**Status shows in `claude-code-rpc status` but not on Discord** — this
means the daemon has session data but isn't (or wasn't, at the time)
connected to Discord. Check the daemon's own log output for the
"Connected to Discord over ..." line; if it's missing, see the previous
point.

**Nothing happens at all, `status` shows no sessions** — the hooks aren't
registered, or you're running a Claude Code version/config where
`~/.claude/settings.json` isn't being read (e.g. a project-local
`.claude/settings.json` that doesn't inherit hooks the way you'd expect —
check Claude Code's own hooks documentation for settings precedence).
Re-run `node bin/claude-code-rpc.js install` and confirm the `hooks` key
appears in `~/.claude/settings.json`.

**I use a Discord client mod (Vencord/BetterDiscord/etc.)** — these
generally keep Discord's own RPC server intact (that's what this project
talks to), so no special handling is needed beyond what's already covered
above for Flatpak/Snap/native.

## Uninstalling

```bash
node bin/claude-code-rpc.js uninstall     # removes just this project's hooks
rm -rf ~/.claude-code-rpc                 # removes all local state/config
```

If you set up autostart in [Step 7](#step-7--run-it-automatically-in-the-background),
also disable/unload that (commands are in that section), then remove the
service/agent file itself and this repo's directory.

## Design notes

- **Zero runtime dependencies.** The Discord IPC protocol (local handshake
  + `SET_ACTIVITY` frames over a Unix socket) is simple enough to
  implement directly in `src/discordIpcClient.js`, so this project doesn't
  pull in a third-party `discord-rpc` package or its transitive
  dependencies just to send a JSON blob down a local socket.
- **File-based state, not a live connection to Claude Code.** Claude Code
  doesn't expose a query API for "what is it doing right now" — hooks are
  the only way to observe agent lifecycle events. Writing them to disk
  (rather than, say, having the hook script talk to the daemon over its
  own socket) means the daemon can be started, stopped, or crash-restarted
  independently of any running `claude` session, and multiple concurrent
  sessions naturally coexist as separate files instead of racing each
  other.
- **Socket auto-discovery, not configuration.** See
  `src/ipcSocketPaths.js` and [How Discord discovery works](#how-discord-discovery-works)
  — the search list was arrived at by actually testing against a
  Flatpak-sandboxed Vesktop install (proxied through Tor) rather than
  assuming a single "standard" path, which is the thing that breaks most
  naive Discord RPC integrations on Linux.

## Privacy

The only data this project handles is: the current working directory's
folder name, the name of the Claude Code tool in use, and event
timestamps — all sourced from Claude Code's own hook payloads. It's
written to a local JSON file and sent to your own local Discord client.
Nothing leaves your machine except what Discord's own client normally
sends as part of your presence status (visible to anyone who can already
see your Discord status — friends, shared servers — same as any other
Rich Presence integration, e.g. Spotify's or a game's).

## License

MIT — see [LICENSE](LICENSE).
