import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LAZY_DOCUMENTS, managedEnd, managedStart } from "./constants.js";
import { executeWritePlan, readManagedSection, sanitizeRegionContent } from "./documents.js";
import { adapterFor, type HostId } from "./hostAdapter.js";
import { findProjectRoot, loadProjectConfig } from "./project.js";
import {
  DEFAULT_CONVERGENCE_THRESHOLD,
  type AmbiguityAxis,
  type WritePlan,
  type WritePlanOperation
} from "./schemas.js";
import { createInitialLedger, loadLedger, unresolvedAxes } from "./scoring.js";
import { loadSessionState } from "./session.js";

// The PRD is a hybrid document: the deterministic core assembles every section
// it has recorded answers for, while four synthesis sections (vision, core
// value, problem/anti-problem, user stories) accept host-agent content via
// koan_synthesize_prd. Host sections persist across rebuilds; deterministic
// sections are always re-derived so a host can never overwrite raw answers.

export interface PrdHostSections {
  vision?: string;
  coreValue?: string;
  problemAntiProblem?: string;
  userStories?: string;
}

export interface BuildPrdInput {
  cwd: string;
  homeDir: string;
  sections?: PrdHostSections;
  host?: HostId;
  dryRun?: boolean;
  isoDate?: string;
}

export interface BuildPrdResult {
  projectRoot: string;
  path: string;
  plan: WritePlan;
  executed: boolean;
  document: string | null;
}

interface PrdSection {
  region: string;
  title: string;
  axis?: AmbiguityAxis;
  hostKey?: keyof PrdHostSections;
}

// §10 output contract order: philosophy first, residual ambiguity last.
export const PRD_SECTIONS: readonly PrdSection[] = [
  { region: "philosophy", title: "Philosophy / Why", axis: "philosophical_intent" },
  { region: "vision", title: "Product Vision", hostKey: "vision" },
  { region: "core-value", title: "Core Value", hostKey: "coreValue" },
  { region: "target-users", title: "Target Users", axis: "target_users" },
  { region: "problem-anti-problem", title: "Problem and Anti-Problem", hostKey: "problemAntiProblem" },
  { region: "scope", title: "Scope", axis: "scope" },
  { region: "non-goals", title: "Non-Goals", axis: "non_goals" },
  { region: "user-stories", title: "User Stories", hostKey: "userStories" },
  { region: "success-criteria", title: "Success Criteria", axis: "success_criteria" },
  { region: "implementation-plan", title: "Implementation Plan", axis: "implementation_plan" },
  { region: "qa-criteria", title: "QA Criteria", axis: "qa_criteria" },
  { region: "handoff-notes", title: "Handoff Notes", axis: "handoff_readiness" },
  { region: "residual-ambiguity", title: "Residual Ambiguity" }
];

const NOT_CLARIFIED_PREFIX = "_Not yet clarified";
const PENDING_SYNTHESIS_PREFIX = "_Pending host synthesis.";

function notClarified(axis: AmbiguityAxis): string {
  return `${NOT_CLARIFIED_PREFIX} (answer the \`${axis}\` question)._`;
}

function pendingSynthesis(host: HostId): string {
  return `${PENDING_SYNTHESIS_PREFIX} ${adapterFor(host).prdSynthesisInstruction}_`;
}

function isPlaceholder(content: string | null): boolean {
  return (
    content === null ||
    content.length === 0 ||
    content.startsWith(NOT_CLARIFIED_PREFIX) ||
    content.startsWith(PENDING_SYNTHESIS_PREFIX)
  );
}

function prdSkeleton(): string {
  const lines = [
    "# PRD",
    "",
    "Synthesized by `koan prd` and `koan_synthesize_prd` from recorded Koan",
    "answers and `koan/philosophy.md`. Managed regions are rewritten on every",
    "synthesis; content outside the markers is preserved.",
    ""
  ];
  for (const section of PRD_SECTIONS) {
    lines.push(`## ${section.title}`, "", managedStart(section.region), managedEnd(section.region), "");
  }
  return lines.join("\n");
}

// Best-effort: collect the first line of each `## <iso> — koan insight` entry
// appended by recordInsight, in file order.
export function parseInsights(philosophyText: string): string[] {
  const insights: string[] = [];
  const blocks = philosophyText.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (!lines[0]?.includes("— koan insight")) continue;
    const body = lines.slice(1).find((line) => line.trim().length > 0);
    if (body) insights.push(body.trim());
  }
  return insights;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildPrd(input: BuildPrdInput): Promise<BuildPrdResult> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state) throw new Error("No active Koan session. Run koan hello first.");
  if (!state.activeGoalId || state.phase === "archived") {
    throw new Error("No active goal. Run koan hello first.");
  }

  const host = input.host ?? "generic";
  const isoDate = input.isoDate ?? new Date().toISOString();

  const latestAnswers = new Map<AmbiguityAxis, string>();
  for (const answer of state.answers) {
    latestAnswers.set(answer.axis, answer.answer);
  }

  const prdPath = join(projectRoot, LAZY_DOCUMENTS.prd);
  const prdExists = await exists(prdPath);
  const existingText = prdExists ? await readFile(prdPath, "utf8") : "";

  const philosophyText = await readFile(join(projectRoot, LAZY_DOCUMENTS.philosophy), "utf8").catch(() => "");
  const insights = parseInsights(philosophyText);

  const stored = await loadLedger(projectRoot);
  const ledger =
    stored && stored.goalId === state.activeGoalId ? stored : createInitialLedger(state.activeGoalId, isoDate);
  const threshold =
    (await loadProjectConfig(projectRoot))?.settings.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const unresolved = unresolvedAxes(ledger, threshold);

  const operations: WritePlanOperation[] = [];
  if (!prdExists) {
    operations.push({ type: "write", path: LAZY_DOCUMENTS.prd, content: prdSkeleton() });
  }

  for (const section of PRD_SECTIONS) {
    let content: string;

    if (section.region === "philosophy") {
      const parts: string[] = [];
      const answer = latestAnswers.get("philosophical_intent");
      parts.push(answer ?? notClarified("philosophical_intent"));
      if (insights.length > 0) {
        parts.push("", "Insights (see `koan/philosophy.md` for the full log):");
        parts.push(...insights.map((insight) => `- ${insight}`));
      }
      content = parts.join("\n");
    } else if (section.region === "residual-ambiguity") {
      content =
        unresolved.length === 0
          ? "None."
          : unresolved.map((axis) => `- \`${axis}\` is below the convergence threshold (${threshold}).`).join("\n");
    } else if (section.hostKey) {
      const provided = input.sections?.[section.hostKey]?.trim();
      const existing = prdExists ? readManagedSection(existingText, section.region) : null;
      const seed = section.region === "vision" ? latestAnswers.get("purpose") : undefined;
      content = provided || (!isPlaceholder(existing) ? (existing as string) : (seed ?? pendingSynthesis(host)));
    } else if (section.axis) {
      content = latestAnswers.get(section.axis) ?? notClarified(section.axis);
    } else {
      content = "";
    }

    operations.push({
      type: "managed-region",
      path: LAZY_DOCUMENTS.prd,
      name: section.region,
      content: sanitizeRegionContent(content)
    });
  }

  const plan: WritePlan = { description: "Synthesize the PRD from recorded answers", operations };

  if (input.dryRun) {
    return { projectRoot, path: LAZY_DOCUMENTS.prd, plan, executed: false, document: null };
  }

  await executeWritePlan(projectRoot, plan, {
    log: { command: "koan prd", summary: "Synthesized the PRD." }
  });
  const document = await readFile(prdPath, "utf8");
  return { projectRoot, path: LAZY_DOCUMENTS.prd, plan, executed: true, document };
}
