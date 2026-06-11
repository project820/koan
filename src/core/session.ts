import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendCommandLogInLock, type CommandLogInput } from "./commandLog.js";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS, STATE_FILES } from "./constants.js";
import { replaceManagedRegion } from "./documents.js";
import { ensureStateGitignore } from "./gitPolicy.js";
import { withFileLock } from "./lock.js";
import { SessionStateSchema, type SessionState } from "./schemas.js";

export function createSessionState(activeGoalId: string | null, isoDate = new Date().toISOString()): SessionState {
  return {
    version: 1,
    sessionId: randomUUID(),
    activeGoalId,
    phase: activeGoalId ? "questioning" : "setup",
    lastQuestionId: null,
    answers: [],
    updatedAt: isoDate
  };
}

export async function loadSessionState(projectRoot: string): Promise<SessionState | null> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.sessionState), "utf8");
    return SessionStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Caller must hold the project write lock or be the locked write-plan path.
async function persistSessionState(projectRoot: string, state: SessionState): Promise<void> {
  const path = join(projectRoot, STATE_FILES.sessionState);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function goalIdFromDate(isoDate = new Date().toISOString()): string {
  return `goal-${isoDate.replace(/[:.]/g, "-")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function archiveGoal(projectRoot: string, goalId: string, log?: CommandLogInput): Promise<void> {
  await withFileLock(projectRoot, async () => {
    await ensureStateGitignore(projectRoot);
    const archiveRoot = join(projectRoot, "koan/archive", goalId);
    await mkdir(archiveRoot, { recursive: true });

    const files = [
      CORE_DOCUMENTS.goal,
      CORE_DOCUMENTS.plan,
      CORE_DOCUMENTS.status,
      LAZY_DOCUMENTS.decisions,
      LAZY_DOCUMENTS.qa,
      LAZY_DOCUMENTS.handoff
    ];

    for (const relative of files) {
      const source = join(projectRoot, relative);
      if (await exists(source)) {
        await copyFile(source, join(archiveRoot, basename(relative)));
      }
    }

    const goalPath = join(projectRoot, CORE_DOCUMENTS.goal);
    const currentGoal = await readFile(goalPath, "utf8").catch(() => "# Goal\n");
    await writeFile(
      goalPath,
      replaceManagedRegion(currentGoal, "active-goal", `No active goal yet.\n\nArchived goal: ${goalId}`),
      "utf8"
    );

    await rm(join(projectRoot, STATE_FILES.ambiguityLedger), { force: true });

    const state = await loadSessionState(projectRoot);
    if (state) {
      await persistSessionState(projectRoot, {
        ...state,
        activeGoalId: null,
        phase: "archived",
        updatedAt: new Date().toISOString()
      });
    }

    if (log) {
      await appendCommandLogInLock(projectRoot, log);
    }
  });
}
