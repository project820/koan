export function buildQaChecklist(): string {
  return [
    "# QA",
    "",
    "## Spec Compliance",
    "",
    "- Does the implementation follow `koan/goal.md`?",
    "- Does the implementation follow `koan/plan.md`?",
    "- Are scope changes recorded through `koan bright-idea`?",
    "",
    "## General Quality",
    "",
    "- Are targeted tests present?",
    "- Are destructive operations avoided?",
    "- Are privacy and local-first assumptions preserved?",
    "",
    "## MCP Host Agent Prompt",
    "",
    "Compare the implementation summary against Koan documents. Separate Koan-spec compliance issues from general quality issues.",
    ""
  ].join("\n");
}
