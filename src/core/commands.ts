import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS, STATE_FILES } from "./constants.js";
import { appendLogEntry, executeWritePlan } from "./documents.js";
import { buildHandoffDocument } from "./handoff.js";
import { ensureKoanProject, findProjectRoot } from "./project.js";
import { buildQaChecklist } from "./qa.js";
import { defaultProfile, loadProfile, saveProfile } from "./profile.js";
import { getQuestion, type KoanQuestion } from "./questions.js";
import { createInitialLedger, selectMostUnclearAxis } from "./scoring.js";
import { createSessionState, goalIdFromDate, loadSessionState, saveSessionState } from "./session.js";

export interface HelloResult {
  projectRoot: string;
  nextQuestion: KoanQuestion | null;
}

export async function hello(input: { cwd: string; homeDir: string }): Promise<HelloResult> {
  const config = await ensureKoanProject(input.cwd);
  const profile = (await loadProfile(input.homeDir)) ?? (await saveProfile(input.homeDir, defaultProfile()));
  const existing = await loadSessionState(config.projectRoot);
  const goalId = existing?.activeGoalId ?? goalIdFromDate();
  const state = existing ?? createSessionState(goalId);
  await saveSessionState(config.projectRoot, state);

  const ledger = createInitialLedger(goalId);
  await writeFile(join(config.projectRoot, STATE_FILES.ambiguityLedger), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

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
  const path = join(projectRoot, LAZY_DOCUMENTS.brightIdeas);
  await mkdir(join(projectRoot, "koan"), { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "# Bright Ideas\n");
  const next = appendLogEntry(existing, "koan bright-idea", input.idea);
  await executeWritePlan(projectRoot, {
    description: "Record bright idea",
    operations: [{ type: "write", path: LAZY_DOCUMENTS.brightIdeas, content: next }]
  });
}

export async function qa(input: { cwd: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  await executeWritePlan(projectRoot, {
    description: "Create QA checklist",
    operations: [{ type: "write", path: LAZY_DOCUMENTS.qa, content: buildQaChecklist() }]
  });
}

export async function handoff(input: { cwd: string; summary: string }): Promise<void> {
  const projectRoot = await findProjectRoot(input.cwd);
  await executeWritePlan(projectRoot, {
    description: "Create handoff",
    operations: [{
      type: "write",
      path: LAZY_DOCUMENTS.handoff,
      content: buildHandoffDocument({ summary: input.summary, experimentalHandoff: false })
    }]
  });
}
