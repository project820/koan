export const KOAN_VERSION = "0.4.0";

export const KOAN_DIR = "koan";
export const KOAN_STATE_DIR = ".koan";

export const CORE_DOCUMENTS = {
  readme: "koan/README.md",
  goal: "koan/goal.md",
  status: "koan/status.md",
  plan: "koan/plan.md"
} as const;

export const LAZY_DOCUMENTS = {
  philosophy: "koan/philosophy.md",
  decisions: "koan/decisions.md",
  openQuestions: "koan/open-questions.md",
  qa: "koan/qa.md",
  handoff: "koan/handoff.md",
  brightIdeas: "koan/bright-ideas.md",
  prd: "koan/prd.md"
} as const;

export const STATE_FILES = {
  project: ".koan/project.json",
  userProfileRef: ".koan/user-profile-ref.json",
  sessionState: ".koan/session-state.json",
  ambiguityLedger: ".koan/ambiguity-ledger.json",
  commandLog: ".koan/command-log.json",
  mcpCache: ".koan/mcp-cache.json",
  gitignore: ".koan/.gitignore",
  lock: ".koan/write.lock"
} as const;

export const BOOTSTRAP_START = "<!-- koan:start -->";
export const BOOTSTRAP_END = "<!-- koan:end -->";

export function managedStart(name: string): string {
  return `<!-- koan:section:start name="${name}" -->`;
}

export function managedEnd(name: string): string {
  return `<!-- koan:section:end name="${name}" -->`;
}
