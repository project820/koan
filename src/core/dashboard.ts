import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCommandLog } from "./commandLog.js";
import { status } from "./commands.js";
import { CORE_DOCUMENTS, LAZY_DOCUMENTS } from "./constants.js";
import { readManagedSection } from "./documents.js";
import { type HostId } from "./hostAdapter.js";
import { parseInsights } from "./prd.js";
import { defaultProfile, loadProfile } from "./profile.js";
import {
  DEFAULT_ACTIVE_GOAL_PLACEHOLDER,
  DEFAULT_STATUS_PLACEHOLDER,
  findProjectRoot,
  loadProjectConfig
} from "./project.js";
import { getQuestion, type KoanQuestion } from "./questions.js";
import {
  DEFAULT_CONVERGENCE_THRESHOLD,
  type AmbiguityAxis,
  type CommandLogEntry,
  type Language
} from "./schemas.js";
import { AXIS_PRIORITY, isConverged, loadLedger, selectMostUnclearAxis, unresolvedAxes } from "./scoring.js";
import { loadSessionState } from "./session.js";

// Read-only by contract: collecting a snapshot must never write project state,
// documents, or the command log — the dashboard is a pure view layer.

export interface DashboardAxis {
  axis: AmbiguityAxis;
  clarity: number;
}

export interface DashboardSnapshot {
  projectRoot: string;
  goalId: string | null;
  phase: string | null;
  axes: DashboardAxis[];
  threshold: number;
  converged: boolean;
  unresolvedCount: number;
  nextQuestion: KoanQuestion | null;
  nextAction: string;
  activeGoal: string | null;
  latestStatus: string | null;
  insights: string[];
  staleWarnings: string[];
  lastCommand: CommandLogEntry | null;
  profileLanguage: Language;
}

async function readRegion(path: string, region: string, placeholder: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return null;
  const section = readManagedSection(text, region);
  if (section === null || section.length === 0 || section.startsWith(placeholder)) return null;
  return section;
}

export async function collectDashboardSnapshot(input: {
  cwd: string;
  homeDir: string;
  host?: HostId;
}): Promise<DashboardSnapshot> {
  const projectRoot = await findProjectRoot(input.cwd);
  const state = await loadSessionState(projectRoot);
  const profile = (await loadProfile(input.homeDir)) ?? defaultProfile();
  const threshold =
    (await loadProjectConfig(projectRoot))?.settings.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;

  const hasGoal = state !== null && state.activeGoalId !== null && state.phase !== "archived";
  const stored = await loadLedger(projectRoot);
  const ledger = hasGoal && stored && stored.goalId === state.activeGoalId ? stored : null;

  const clarityByAxis = new Map(ledger?.axes.map((entry) => [entry.axis, entry.clarity]) ?? []);
  const axes: DashboardAxis[] = AXIS_PRIORITY.map((axis) => ({
    axis,
    clarity: clarityByAxis.get(axis) ?? 0
  }));

  const converged =
    hasGoal && (state.phase === "ready" || (ledger !== null && isConverged(ledger, threshold)));
  const nextQuestion =
    hasGoal && !converged && ledger !== null
      ? getQuestion(selectMostUnclearAxis(ledger), profile, input.host ?? "generic")
      : null;
  const unresolvedCount = ledger !== null && !converged ? unresolvedAxes(ledger, threshold).length : 0;

  const { nextAction, staleWarnings } = await status({ cwd: projectRoot });

  const philosophyText = await readFile(join(projectRoot, LAZY_DOCUMENTS.philosophy), "utf8").catch(() => "");
  const log = await loadCommandLog(projectRoot);

  return {
    projectRoot,
    goalId: hasGoal ? state.activeGoalId : null,
    phase: state?.phase ?? null,
    axes,
    threshold,
    converged,
    unresolvedCount,
    nextQuestion,
    nextAction,
    activeGoal: await readRegion(
      join(projectRoot, CORE_DOCUMENTS.goal),
      "active-goal",
      DEFAULT_ACTIVE_GOAL_PLACEHOLDER
    ),
    latestStatus: await readRegion(
      join(projectRoot, CORE_DOCUMENTS.status),
      "current-status",
      DEFAULT_STATUS_PLACEHOLDER
    ),
    insights: parseInsights(philosophyText),
    staleWarnings,
    lastCommand: log.entries.at(-1) ?? null,
    profileLanguage: profile.language
  };
}
