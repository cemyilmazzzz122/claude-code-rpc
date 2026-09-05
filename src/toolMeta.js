// Maps a Claude Code tool name (as seen in PreToolUse/PostToolUse hook
// payloads) to a human-readable label and an icon key. Icon keys must match
// image asset names uploaded to the Discord Application's Rich Presence
// art assets (see README "Discord application setup").
const TOOL_MAP = {
  Read: { label: "Reading files", icon: "read" },
  Edit: { label: "Editing code", icon: "edit" },
  Write: { label: "Writing files", icon: "edit" },
  NotebookEdit: { label: "Editing a notebook", icon: "edit" },
  Bash: { label: "Running a command", icon: "terminal" },
  Grep: { label: "Searching code", icon: "search" },
  Glob: { label: "Searching files", icon: "search" },
  WebSearch: { label: "Searching the web", icon: "search" },
  WebFetch: { label: "Browsing the web", icon: "search" },
  Task: { label: "Running a subagent", icon: "agent" },
  Agent: { label: "Running a subagent", icon: "agent" },
  TodoWrite: { label: "Updating the task list", icon: "edit" },
  ExitPlanMode: { label: "Planning", icon: "think" },
};

export function describeTool(toolName) {
  if (!toolName) return { label: "Working", icon: "think" };
  return TOOL_MAP[toolName] || { label: `Using ${toolName}`, icon: "think" };
}
