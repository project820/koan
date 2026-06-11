import { AmbiguityAxisSchema, type AmbiguityAxis, type AmbiguityLedger } from "./schemas.js";

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
            evidence: [...entry.evidence, evidence],
            updatedAt: isoDate
          }
        : entry
    )
  };
}
