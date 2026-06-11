import { access } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS } from "./constants.js";
import { executeWritePlan, sanitizeRegionContent } from "./documents.js";
import { defaultProfile, loadProfile } from "./profile.js";
import { findProjectRoot, loadProjectConfig } from "./project.js";
import { getQuestion } from "./questions.js";
import {
  DEFAULT_CONVERGENCE_THRESHOLD,
  type AmbiguityAxis,
  type WritePlan,
  type WritePlanOperation
} from "./schemas.js";
import { createInitialLedger, loadLedger, unresolvedAxes } from "./scoring.js";
import { loadSessionState } from "./session.js";

interface AxisTarget {
  axis: AmbiguityAxis;
  path: string;
  region: string;
  bootstrapHeader?: string;
}

// Deterministic mapping from answered axes to managed regions. goal.md and
// plan.md always exist after hello; lazy documents are bootstrapped with their
// H1 the first time an answer lands in them.
const AXIS_TARGETS: readonly AxisTarget[] = [
  { axis: "current_goal", path: CORE_DOCUMENTS.goal, region: "active-goal" },
  { axis: "purpose", path: CORE_DOCUMENTS.goal, region: "purpose" },
  { axis: "target_users", path: CORE_DOCUMENTS.goal, region: "target-users" },
  { axis: "scope", path: CORE_DOCUMENTS.goal, region: "scope" },
  { axis: "non_goals", path: CORE_DOCUMENTS.goal, region: "non-goals" },
  { axis: "success_criteria", path: CORE_DOCUMENTS.goal, region: "success-criteria" },
  { axis: "constraints", path: CORE_DOCUMENTS.goal, region: "constraints" },
  { axis: "implementation_plan", path: CORE_DOCUMENTS.plan, region: "implementation-plan" },
  { axis: "philosophical_intent", path: LAZY_DOCUMENTS.philosophy, region: "philosophy", bootstrapHeader: "# Philosophy\n" },
  { axis: "qa_criteria", path: LAZY_DOCUMENTS.qa, region: "qa-criteria", bootstrapHeader: "# QA\n" },
  { axis: "handoff_readiness", path: LAZY_DOCUMENTS.handoff, region: "handoff-context", bootstrapHeader: "# Handoff\n" }
];

export interface CrystallizeInput {
  cwd: string;
  homeDir: string;
  dryRun?: boolean;
  isoDate?: string;
}

export interface CrystallizeResult {
  projectRoot: string;
  plan: WritePlan;
  executed: boolean;
  files: string[];
  crystallizedAxes: AmbiguityAxis[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function crystallize(input: CrystallizeInput): Promise<CrystallizeResult> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state) throw new Error("No active Koan session. Run koan hello first.");
  if (!state.activeGoalId || state.phase === "archived") {
    throw new Error("No active goal. Run koan hello first.");
  }

  const isoDate = input.isoDate ?? new Date().toISOString();
  const description = "Crystallize recorded answers into project documents";

  const latestAnswers = new Map<AmbiguityAxis, string>();
  for (const answer of state.answers) {
    latestAnswers.set(answer.axis, answer.answer);
  }

  const targets = AXIS_TARGETS.filter((target) => latestAnswers.has(target.axis));
  const crystallizedAxes = targets.map((target) => target.axis);

  if (crystallizedAxes.length === 0) {
    return {
      projectRoot,
      plan: { description, operations: [] },
      executed: false,
      files: [],
      crystallizedAxes: []
    };
  }

  const operations: WritePlanOperation[] = [];
  for (const target of targets) {
    if (target.bootstrapHeader && !(await exists(join(projectRoot, target.path)))) {
      operations.push({ type: "write", path: target.path, content: target.bootstrapHeader });
    }
    operations.push({
      type: "managed-region",
      path: target.path,
      name: target.region,
      content: sanitizeRegionContent((latestAnswers.get(target.axis) ?? "").trim())
    });
  }

  const stored = await loadLedger(projectRoot);
  const ledger =
    stored && stored.goalId === state.activeGoalId ? stored : createInitialLedger(state.activeGoalId, isoDate);
  const threshold =
    (await loadProjectConfig(projectRoot))?.settings.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const unresolved = unresolvedAxes(ledger, threshold);
  const hasOpenQuestionsFile = await exists(join(projectRoot, LAZY_DOCUMENTS.openQuestions));

  if (unresolved.length > 0) {
    const profile = (await loadProfile(input.homeDir)) ?? defaultProfile();
    if (!hasOpenQuestionsFile) {
      operations.push({ type: "write", path: LAZY_DOCUMENTS.openQuestions, content: "# Open Questions\n" });
    }
    operations.push({
      type: "managed-region",
      path: LAZY_DOCUMENTS.openQuestions,
      name: "open-questions",
      content: unresolved
        .map((axis) => `- ${axis}: ${getQuestion(axis, profile).userFacingQuestion}`)
        .join("\n")
    });
  } else if (hasOpenQuestionsFile) {
    operations.push({
      type: "managed-region",
      path: LAZY_DOCUMENTS.openQuestions,
      name: "open-questions",
      content: "None."
    });
  }

  operations.push({
    type: "append",
    path: LAZY_DOCUMENTS.decisions,
    content: `## ${isoDate} — koan crystallize\n\nCrystallized axes: ${crystallizedAxes.join(", ")}.`,
    headerIfMissing: "# Decisions"
  });

  const plan: WritePlan = { description, operations };
  const files: string[] = [];
  for (const operation of operations) {
    if (!files.includes(operation.path)) files.push(operation.path);
  }

  if (input.dryRun) {
    return { projectRoot, plan, executed: false, files, crystallizedAxes };
  }

  await executeWritePlan(projectRoot, plan, {
    log: { command: "koan crystallize", summary: `Crystallized ${crystallizedAxes.length} axes.` }
  });
  return { projectRoot, plan, executed: true, files, crystallizedAxes };
}
