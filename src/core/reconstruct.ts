import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS } from "./constants.js";
import { readManagedSection } from "./documents.js";
import {
  DEFAULT_ACTIVE_GOAL_PLACEHOLDER,
  DEFAULT_PLAN_PLACEHOLDER,
  DEFAULT_STATUS_PLACEHOLDER
} from "./project.js";
import { createInitialLedger, updateAxisScore } from "./scoring.js";
import { createSessionState, goalIdFromDate } from "./session.js";
import type { AmbiguityAxis, AmbiguityLedger, SessionState } from "./schemas.js";

const RECONSTRUCTED_CLARITY = 0.5;

export interface ReconstructionResult {
  state: SessionState;
  ledger: AmbiguityLedger;
  sources: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sectionHasContent(section: string | null, placeholder: string): boolean {
  return section !== null && section.length > 0 && !section.startsWith(placeholder);
}

// Best-effort recovery per spec §9.5: when session state is missing but koan/*.md
// exists, rebuild a conservative in-memory session and ledger. Never writes to disk.
export async function reconstructFromDocuments(
  projectRoot: string,
  isoDate = new Date().toISOString()
): Promise<ReconstructionResult | null> {
  const goalPath = join(projectRoot, CORE_DOCUMENTS.goal);
  if (!(await exists(goalPath))) return null;

  const goalId = goalIdFromDate(isoDate);
  const state = createSessionState(goalId, isoDate);
  let ledger = createInitialLedger(goalId, isoDate);
  const sources: string[] = [];

  const grant = (axis: AmbiguityAxis, relativePath: string): void => {
    ledger = updateAxisScore(ledger, axis, RECONSTRUCTED_CLARITY, `reconstructed from ${relativePath}`, isoDate);
    if (!sources.includes(relativePath)) sources.push(relativePath);
  };

  const goalText = await readFile(goalPath, "utf8");
  if (sectionHasContent(readManagedSection(goalText, "active-goal"), DEFAULT_ACTIVE_GOAL_PLACEHOLDER)) {
    grant("purpose", CORE_DOCUMENTS.goal);
    grant("current_goal", CORE_DOCUMENTS.goal);
  }

  const planPath = join(projectRoot, CORE_DOCUMENTS.plan);
  if (await exists(planPath)) {
    const planText = await readFile(planPath, "utf8");
    if (sectionHasContent(readManagedSection(planText, "implementation-plan"), DEFAULT_PLAN_PLACEHOLDER)) {
      grant("implementation_plan", CORE_DOCUMENTS.plan);
    }
  }

  const statusPath = join(projectRoot, CORE_DOCUMENTS.status);
  if (await exists(statusPath)) {
    const statusText = await readFile(statusPath, "utf8");
    if (sectionHasContent(readManagedSection(statusText, "current-status"), DEFAULT_STATUS_PLACEHOLDER)) {
      grant("handoff_readiness", CORE_DOCUMENTS.status);
    }
  }

  if (await exists(join(projectRoot, LAZY_DOCUMENTS.qa))) {
    grant("qa_criteria", LAZY_DOCUMENTS.qa);
  }

  if (await exists(join(projectRoot, LAZY_DOCUMENTS.philosophy))) {
    grant("philosophical_intent", LAZY_DOCUMENTS.philosophy);
  }

  return { state, ledger, sources };
}
