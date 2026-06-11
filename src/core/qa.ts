import { DEFAULT_ACTIVE_GOAL_PLACEHOLDER, DEFAULT_PLAN_PLACEHOLDER } from "./project.js";

export interface QaContext {
  activeGoal: string | null;
  planSection: string | null;
}

function stripListMarker(line: string): string {
  return line.replace(/^(?:\d+[.)]\s+|[-*]\s+)/, "");
}

export function buildQaChecklist(context: QaContext = { activeGoal: null, planSection: null }): string {
  const lines: string[] = ["# QA"];

  if (context.activeGoal !== null && !context.activeGoal.startsWith(DEFAULT_ACTIVE_GOAL_PLACEHOLDER)) {
    lines.push("", "## Active Goal Under Review", "", context.activeGoal);
  }

  lines.push(
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
    ""
  );

  if (context.planSection !== null && !context.planSection.startsWith(DEFAULT_PLAN_PLACEHOLDER)) {
    const checks = context.planSection
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `- [ ] ${stripListMarker(line)}`);
    if (checks.length > 0) {
      lines.push("## Plan-Derived Checks", "", ...checks, "");
    }
  }

  lines.push(
    "## MCP Host Agent Prompt",
    "",
    "Compare the implementation summary against Koan documents. Separate Koan-spec compliance issues from general quality issues.",
    ""
  );

  return lines.join("\n");
}
