// Turns a session status record (written by hooks/claude-rpc-hook.mjs) into
// a Discord Rich Presence activity payload.
export function buildActivity(session) {
  if (!session) return null;

  const project = session.project || "a project";
  const detail = session.activityLabel || "Working";

  const activity = {
    details: truncate(detail, 128),
    state: truncate(`in ${project}`, 128),
    timestamps: {
      start: session.sessionStartedAt || session.updatedAt,
    },
    assets: {
      large_image: "claude",
      large_text: "Claude Code",
      small_image: session.icon || "think",
      small_text: truncate(detail, 128),
    },
    // Rich Presence requires this to be a boolean; false = not a "join a
    // match" style instance.
    instance: false,
  };

  if (session.showButton !== false) {
    activity.buttons = [
      { label: "Get Claude Code", url: "https://claude.com/claude-code" },
    ];
  }

  return activity;
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}
