export function defaultKoanGitignore(): string {
  return [
    "user-profile-ref.json",
    "session-state.json",
    "ambiguity-ledger.json",
    "command-log.json",
    "mcp-cache.json",
    "write.lock",
    ""
  ].join("\n");
}
