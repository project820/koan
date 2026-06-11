import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { AmbiguityAxisSchema, AmbiguityLedgerSchema, type AmbiguityAxis, type AmbiguityLedger } from "./schemas.js";

export const ANSWERED_CLARITY = 0.8;

export function createInitialLedger(goalId: string, isoDate = new Date().toISOString()): AmbiguityLedger {
  return {
    version: 1,
    goalId,
    axes: AmbiguityAxisSchema.options.map((axis) => ({
      axis,
      clarity: 0,
      evidence: [],
      updatedAt: isoDate
    }))
  };
}

export function selectMostUnclearAxis(ledger: AmbiguityLedger): AmbiguityAxis {
  const sorted = [...ledger.axes].sort((a, b) => a.clarity - b.clarity);
  return sorted[0]?.axis ?? "purpose";
}

export function updateAxisScore(
  ledger: AmbiguityLedger,
  axis: AmbiguityAxis,
  clarity: number,
  evidence: string,
  isoDate = new Date().toISOString()
): AmbiguityLedger {
  return {
    ...ledger,
    axes: ledger.axes.map((entry) =>
      entry.axis === axis
        ? {
            ...entry,
            clarity: Math.max(0, Math.min(1, clarity)),
            evidence: evidence ? [...entry.evidence, evidence] : entry.evidence,
            updatedAt: isoDate
          }
        : entry
    )
  };
}

export async function loadLedger(projectRoot: string): Promise<AmbiguityLedger | null> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.ambiguityLedger), "utf8");
    return AmbiguityLedgerSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function isConverged(ledger: AmbiguityLedger, threshold: number): boolean {
  return ledger.axes.every((entry) => entry.clarity >= threshold);
}

export function unresolvedAxes(ledger: AmbiguityLedger, threshold: number): AmbiguityAxis[] {
  const schemaOrder = new Map(AmbiguityAxisSchema.options.map((axis, index) => [axis, index]));
  return ledger.axes
    .filter((entry) => entry.clarity < threshold)
    .sort(
      (a, b) =>
        a.clarity - b.clarity ||
        (schemaOrder.get(a.axis) ?? 0) - (schemaOrder.get(b.axis) ?? 0)
    )
    .map((entry) => entry.axis);
}
