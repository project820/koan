import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS, STATE_FILES } from "./constants.js";
import { executeWritePlan } from "./documents.js";
import { buildHandoffDocument } from "./handoff.js";
import { ensureKoanProject, findProjectRoot } from "./project.js";
import { ensureProfileRef } from "./profileRef.js";
import { buildQaChecklist } from "./qa.js";
import { defaultProfile, loadProfile, saveProfile } from "./profile.js";
import { getQuestion, type KoanQuestion } from "./questions.js";
import { createInitialLedger, selectMostUnclearAxis } from "./scoring.js";
import { createSessionState, goalIdFromDate, loadSessionState } from "./session.js";

export interface HelloResult {
  projectRoot: string;
  nextQuestion: KoanQuestion | null;
}

export async function hello(input: { cwd: string; homeDir: string }): Promise<HelloResult> {
  const config = await ensureKoanProject(input.cwd);
  await ensureProfileRef(config.projectRoot, input.homeDir);
  const profile = (await loadProfile(input.homeDir)) ?? (await saveProfile(input.homeDir, defaultProfile()));
  const existing = await loadSessionState(config.projectRoot);
  const goalId = existing?.activeGoalId ?? goalIdFromDate();
  const state = existing ?? createSessionState(goalId);
  const ledger = createInitialLedger(goalId);

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

  const axis = selectMostUnclearAxis(ledger);
  return { projectRoot: config.projectRoot, nextQuestion: getQuestion(axis, profile) };
}

export async function status(input: { cwd: string }): Promise<{ summary: string; didWrite: boolean }> {
  const projectRoot = await findProjectRoot(input.cwd);
  const goal = await readFile(join(projectRoot, CORE_DOCUMENTS.goal), "utf8").catch(() => "# Goal\n");
  const current = await readFile(join(projectRoot, CORE_DOCUMENTS.status), "utf8").catch(() => "# Status\n");
  return { summary: `Active Goal\n\n${goal}\n\nCurrent Status\n\n${current}`, didWrite: false };
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
