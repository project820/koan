import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS, STATE_FILES } from "./constants.js";
import { executeWritePlan } from "./documents.js";
import { buildHandoffDocument } from "./handoff.js";
import { ensureKoanProject, findProjectRoot, loadProjectConfig } from "./project.js";
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
  type SessionState
} from "./schemas.js";
import { createInitialLedger, isConverged, loadLedger, selectMostUnclearAxis, unresolvedAxes } from "./scoring.js";
import { archiveGoal, createSessionState, goalIdFromDate, loadSessionState } from "./session.js";

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
  const converged = isConverged(ledger, threshold);
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
): Promise<{ summary: string; didWrite: boolean; nextAction: string }> {
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

  return {
    summary: `Active Goal\n\n${goal}\n\nCurrent Status\n\n${current}\n\nNext action: ${nextAction}`,
    didWrite: false,
    nextAction
  };
}

export async function archive(input: { cwd: string }): Promise<{ archivedGoalId: string }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state?.activeGoalId) throw new Error("No active goal to archive.");
  const goalId = state.activeGoalId;
  await archiveGoal(projectRoot, goalId, { command: "koan archive", summary: `Archived goal ${goalId}.` });
  return { archivedGoalId: goalId };
}

export async function brightIdea(input: { cwd: string; idea: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  const entry = `## ${new Date().toISOString()} — koan bright-idea\n\n${input.idea.trimEnd()}`;
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
}

export async function qa(input: { cwd: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  await executeWritePlan(
    projectRoot,
    {
      description: "Create QA checklist",
      operations: [{ type: "write", path: LAZY_DOCUMENTS.qa, content: buildQaChecklist() }]
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
