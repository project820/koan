import { STATE_FILES } from "./constants.js";
import { executeWritePlan } from "./documents.js";
import { defaultProfile, loadProfile } from "./profile.js";
import { findProjectRoot, loadProjectConfig } from "./project.js";
import { getQuestion, type KoanQuestion } from "./questions.js";
import {
  DEFAULT_CONVERGENCE_THRESHOLD,
  type AmbiguityAxis,
  type AmbiguityLedger,
  type AnswerRecord,
  type SessionState
} from "./schemas.js";
import {
  ANSWERED_CLARITY,
  createInitialLedger,
  isConverged,
  loadLedger,
  selectMostUnclearAxis,
  unresolvedAxes,
  updateAxisScore
} from "./scoring.js";
import { loadSessionState } from "./session.js";

const EVIDENCE_PREVIEW_LIMIT = 120;

export interface RecordAnswerInput {
  cwd: string;
  homeDir: string;
  axis: AmbiguityAxis;
  answer: string;
  clarity?: number;
  question?: string;
  isoDate?: string;
}

export interface RecordAnswerResult {
  projectRoot: string;
  ledger: AmbiguityLedger;
  answer: AnswerRecord;
  converged: boolean;
  unresolved: AmbiguityAxis[];
  nextQuestion: KoanQuestion | null;
}

export async function recordAnswer(input: RecordAnswerInput): Promise<RecordAnswerResult> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state) throw new Error("No active Koan session. Run koan hello first.");
  if (!state.activeGoalId || state.phase === "archived") {
    throw new Error("No active goal. Run koan hello first.");
  }
  if (input.clarity !== undefined && (!Number.isFinite(input.clarity) || input.clarity < 0 || input.clarity > 1)) {
    throw new Error("clarity must be a finite number between 0 and 1.");
  }

  const profile = (await loadProfile(input.homeDir)) ?? defaultProfile();
  const isoDate = input.isoDate ?? new Date().toISOString();
  const stored = await loadLedger(projectRoot);
  const ledger =
    stored && stored.goalId === state.activeGoalId
      ? stored
      : createInitialLedger(state.activeGoalId, isoDate);

  const trimmed = input.answer.trim();
  const clarity = input.clarity ?? (trimmed.length > 0 ? ANSWERED_CLARITY : 0);
  const updatedLedger = updateAxisScore(ledger, input.axis, clarity, Array.from(trimmed).slice(0, EVIDENCE_PREVIEW_LIMIT).join(""), isoDate);

  const answer: AnswerRecord = {
    questionId: input.axis,
    axis: input.axis,
    question: input.question ?? getQuestion(input.axis, profile).userFacingQuestion,
    answer: input.answer,
    recordedAt: isoDate
  };

  const threshold = (await loadProjectConfig(projectRoot))?.settings.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const converged = isConverged(updatedLedger, threshold);
  const nextState: SessionState = {
    ...state,
    answers: [...state.answers, answer],
    lastQuestionId: input.axis,
    phase: converged ? "ready" : "questioning",
    updatedAt: isoDate
  };

  await executeWritePlan(
    projectRoot,
    {
      description: "Persist recorded answer and ambiguity ledger",
      operations: [
        { type: "write", path: STATE_FILES.sessionState, content: `${JSON.stringify(nextState, null, 2)}\n` },
        { type: "write", path: STATE_FILES.ambiguityLedger, content: `${JSON.stringify(updatedLedger, null, 2)}\n` }
      ]
    },
    { log: { command: "koan answer", summary: `Recorded answer for ${input.axis}.` } }
  );

  return {
    projectRoot,
    ledger: updatedLedger,
    answer,
    converged,
    unresolved: unresolvedAxes(updatedLedger, threshold),
    nextQuestion: converged ? null : getQuestion(selectMostUnclearAxis(updatedLedger), profile)
  };
}

export async function acceptClarity(input: { cwd: string; isoDate?: string }): Promise<{ projectRoot: string }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  if (!state) throw new Error("No active Koan session. Run koan hello first.");
  if (!state.activeGoalId || state.phase === "archived") {
    throw new Error("No active goal. Run koan hello first.");
  }
  const isoDate = input.isoDate ?? new Date().toISOString();
  const nextState: SessionState = { ...state, phase: "ready", updatedAt: isoDate };
  await executeWritePlan(
    projectRoot,
    {
      description: "Accept current clarity as enough",
      operations: [
        { type: "write", path: STATE_FILES.sessionState, content: `${JSON.stringify(nextState, null, 2)}\n` }
      ]
    },
    { log: { command: "koan enough", summary: "Accepted current clarity as enough." } }
  );
  return { projectRoot };
}
