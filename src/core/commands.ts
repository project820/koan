import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS, STATE_FILES } from "./constants.js";
import { executeWritePlan, readManagedSection } from "./documents.js";
import { buildHandoffDocument } from "./handoff.js";
import {
  DEFAULT_ACTIVE_GOAL_PLACEHOLDER,
  ensureKoanProject,
  findProjectRoot,
  loadProjectConfig
} from "./project.js";
import { ensureProfileRef } from "./profileRef.js";
import { buildQaChecklist } from "./qa.js";
import { defaultProfile, loadProfile, saveProfile } from "./profile.js";
import { getQuestion, type KoanQuestion } from "./questions.js";
import { reconstructFromDocuments } from "./reconstruct.js";
import {
  DEFAULT_CONVERGENCE_THRESHOLD,
  type AmbiguityAxis,
  type AmbiguityLedger,
  type AnswerRecord,
  type SessionState,
  type WritePlanOperation
} from "./schemas.js";
import { createInitialLedger, isConverged, loadLedger, selectMostUnclearAxis, unresolvedAxes } from "./scoring.js";
import { archiveGoal, createSessionState, goalIdFromDate, loadSessionState } from "./session.js";

const STALE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface HelloResult {
  projectRoot: string;
  resumed: boolean;
  activeGoalId: string | null;
  lastAnswer: AnswerRecord | null;
  unresolved: AmbiguityAxis[];
  converged: boolean;
  reconstructed: boolean;
  nextQuestion: KoanQuestion | null;
}

export async function hello(input: { cwd: string; homeDir: string }): Promise<HelloResult> {
  const config = await ensureKoanProject(input.cwd);
  await ensureProfileRef(config.projectRoot, input.homeDir);
  const profile = (await loadProfile(input.homeDir)) ?? (await saveProfile(input.homeDir, defaultProfile()));
  const existing = await loadSessionState(config.projectRoot);

  let state: SessionState;
  let ledger: AmbiguityLedger;
  let reconstructed = false;
  let resumed = false;

  if (existing && existing.activeGoalId && existing.phase !== "archived") {
    const stored = await loadLedger(config.projectRoot);
    state = existing;
    ledger =
      stored && stored.goalId === existing.activeGoalId
        ? stored
        : createInitialLedger(existing.activeGoalId);
    resumed = true;
  } else if (!existing) {
    const survivingLedger = await loadLedger(config.projectRoot);
    const recovered = survivingLedger ? null : await reconstructFromDocuments(config.projectRoot);
    if (survivingLedger) {
      state = createSessionState(survivingLedger.goalId);
      ledger = survivingLedger;
    } else if (recovered && recovered.sources.length > 0) {
      state = recovered.state;
      ledger = recovered.ledger;
      reconstructed = true;
    } else {
      const goalId = goalIdFromDate();
      state = createSessionState(goalId);
      ledger = createInitialLedger(goalId);
    }
  } else {
    const goalId = goalIdFromDate();
    state = createSessionState(goalId);
    ledger = createInitialLedger(goalId);
  }

  await executeWritePlan(
    config.projectRoot,
    {
      description: "Persist session state and ambiguity ledger",
      operations: [
        { type: "write", path: STATE_FILES.sessionState, content: `${JSON.stringify(state, null, 2)}\n` },
        { type: "write", path: STATE_FILES.ambiguityLedger, content: `${JSON.stringify(ledger, null, 2)}\n` }
      ]
    },
    { log: { command: "koan hello", summary: "Initialized or resumed Koan session." } }
  );

  const threshold = config.settings.convergenceThreshold;
  const converged = state.phase === "ready" || isConverged(ledger, threshold);
  return {
    projectRoot: config.projectRoot,
    resumed,
    activeGoalId: state.activeGoalId,
    lastAnswer: state.answers.at(-1) ?? null,
    unresolved: unresolvedAxes(ledger, threshold),
    converged,
    reconstructed,
    nextQuestion: converged ? null : getQuestion(selectMostUnclearAxis(ledger), profile)
  };
}

export async function status(
  input: { cwd: string }
): Promise<{ summary: string; didWrite: boolean; nextAction: string; staleWarnings: string[] }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const goal = await readFile(join(projectRoot, CORE_DOCUMENTS.goal), "utf8").catch(() => "# Goal\n");
  const current = await readFile(join(projectRoot, CORE_DOCUMENTS.status), "utf8").catch(() => "# Status\n");
  const session = await loadSessionState(projectRoot);
  const ledger = await loadLedger(projectRoot);
  const threshold = (await loadProjectConfig(projectRoot))?.settings.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;

  let nextAction: string;
  if (!session) {
    nextAction = "run koan hello";
  } else if (session.phase === "archived" || !session.activeGoalId) {
    nextAction = "run koan hello to start a new goal";
  } else if (
    session.phase === "ready" ||
    (ledger !== null && ledger.goalId === session.activeGoalId && isConverged(ledger, threshold))
  ) {
    nextAction = "archive the completed goal (koan archive)";
  } else if (!ledger || ledger.goalId !== session.activeGoalId) {
    nextAction = "run koan hello";
  } else {
    nextAction = `answer the ${selectMostUnclearAxis(ledger)} question (${unresolvedAxes(ledger, threshold).length} axes unresolved)`;
  }

  const staleWarnings: string[] = [];
  if (session && Date.now() - Date.parse(session.updatedAt) > STALE_SESSION_MS) {
    staleWarnings.push(`session state is stale (last updated ${session.updatedAt})`);
  }
  if (session && session.answers.length > 0) {
    const activeGoal = readManagedSection(goal, "active-goal");
    if (activeGoal === null || activeGoal.startsWith(DEFAULT_ACTIVE_GOAL_PLACEHOLDER)) {
      staleWarnings.push("recorded answers are not crystallized yet (run koan crystallize)");
    }
  }

  let summary = `Active Goal\n\n${goal}\n\nCurrent Status\n\n${current}\n\nNext action: ${nextAction}`;
  if (staleWarnings.length > 0) {
    summary += `\n\nWarnings:\n${staleWarnings.map((warning) => `- ${warning}`).join("\n")}`;
  }

  return { summary, didWrite: false, nextAction, staleWarnings };
}

export interface UpdateStatusInput {
  cwd: string;
  update: string;
  isoDate?: string;
}

export async function updateStatus(input: UpdateStatusInput): Promise<{ projectRoot: string }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state) throw new Error("No active Koan session. Run koan hello first.");
  const update = input.update.trim();
  if (!update) throw new Error("Status update text is required.");
  const isoDate = input.isoDate ?? new Date().toISOString();

  const operations: WritePlanOperation[] = [
    { type: "managed-region", path: CORE_DOCUMENTS.status, name: "current-status", content: update }
  ];
  if (!(await exists(join(projectRoot, LAZY_DOCUMENTS.handoff)))) {
    operations.push({ type: "write", path: LAZY_DOCUMENTS.handoff, content: "# Handoff\n" });
  }
  operations.push(
    {
      type: "managed-region",
      path: LAZY_DOCUMENTS.handoff,
      name: "latest-status",
      content: `${update}\n\n(Updated ${isoDate} via koan status)`
    },
    {
      type: "write",
      path: STATE_FILES.sessionState,
      content: `${JSON.stringify({ ...state, updatedAt: isoDate }, null, 2)}\n`
    }
  );

  await executeWritePlan(
    projectRoot,
    { description: "Record status update", operations },
    { log: { command: "koan status", summary: "Recorded a status update." } }
  );

  return { projectRoot };
}

export async function archive(input: { cwd: string }): Promise<{ archivedGoalId: string }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state?.activeGoalId) throw new Error("No active goal to archive.");
  const goalId = state.activeGoalId;
  await archiveGoal(projectRoot, goalId, { command: "koan archive", summary: `Archived goal ${goalId}.` });
  return { archivedGoalId: goalId };
}

export type BrightIdeaClassification = "clarify" | "change-goal" | "follow-up" | "reject";

const BRIGHT_IDEA_RECOMMENDATIONS: Record<BrightIdeaClassification, string> = {
  clarify: "Refine the current goal with koan hello before implementing.",
  "change-goal": "Archive or re-scope the current goal before adopting this direction.",
  "follow-up": "Keep the current plan; revisit this after the active goal completes.",
  reject: "Recorded for reference; no action planned."
};

export async function brightIdea(
  input: { cwd: string; idea: string; classification?: BrightIdeaClassification }
): Promise<{ classification: BrightIdeaClassification; recommendation: string }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const classification = input.classification ?? "follow-up";
  const entry = `## ${new Date().toISOString()} — koan bright-idea\n\nClassification: ${classification}\n\n${input.idea.trim()}`;
  await executeWritePlan(
    projectRoot,
    {
      description: "Record bright idea",
      operations: [
        {
          type: "append",
          path: LAZY_DOCUMENTS.brightIdeas,
          content: entry,
          headerIfMissing: "# Bright Ideas"
        }
      ]
    },
    { log: { command: "koan bright-idea", summary: "Recorded a bright idea." } }
  );
  return { classification, recommendation: BRIGHT_IDEA_RECOMMENDATIONS[classification] };
}

export async function qa(input: { cwd: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  const goalText = await readFile(join(projectRoot, CORE_DOCUMENTS.goal), "utf8").catch(() => null);
  const planText = await readFile(join(projectRoot, CORE_DOCUMENTS.plan), "utf8").catch(() => null);
  const checklist = buildQaChecklist({
    activeGoal: goalText === null ? null : readManagedSection(goalText, "active-goal"),
    planSection: planText === null ? null : readManagedSection(planText, "implementation-plan")
  });
  await executeWritePlan(
    projectRoot,
    {
      description: "Create QA checklist",
      operations: [{ type: "write", path: LAZY_DOCUMENTS.qa, content: checklist }]
    },
    { log: { command: "koan qa", summary: "Generated QA checklist." } }
  );
}

export async function handoff(input: { cwd: string; summary: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  await executeWritePlan(
    projectRoot,
    {
      description: "Create handoff",
      operations: [{
        type: "write",
        path: LAZY_DOCUMENTS.handoff,
        content: buildHandoffDocument({ summary: input.summary, experimentalHandoff: false })
      }]
    },
    { log: { command: "koan handoff", summary: "Created handoff document." } }
  );
}
