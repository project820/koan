import { describe, expect, it } from "vitest";
import { createInitialLedger, selectMostUnclearAxis, updateAxisScore } from "../src/core/scoring.js";
import { getQuestion } from "../src/core/questions.js";
import { defaultProfile } from "../src/core/profile.js";

describe("questions", () => {
  it("translates the same axis for different profile levels", () => {
    const beginner = getQuestion("success_criteria", defaultProfile({ developmentUnderstanding: "beginner", language: "en" }));
    const expert = getQuestion("success_criteria", defaultProfile({ developmentUnderstanding: "expert", language: "en" }));

    expect(beginner.userFacingQuestion).toContain("finished");
    expect(expert.userFacingQuestion).toContain("acceptance");
  });

  it("supports Korean profile questions", () => {
    const question = getQuestion("philosophical_intent", defaultProfile({ developmentUnderstanding: "non_technical", language: "ko" }));
    expect(question.userFacingQuestion).toContain("왜");
  });
});

describe("scoring", () => {
  it("starts with all axes unclear", () => {
    const ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    expect(ledger.axes).toHaveLength(11);
    expect(selectMostUnclearAxis(ledger)).toBe("purpose");
  });

  it("selects the next unclear axis after an update", () => {
    const ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    const updated = updateAxisScore(ledger, "purpose", 0.9, "User explained purpose.", "2026-06-11T00:01:00.000Z");
    expect(selectMostUnclearAxis(updated)).toBe("target_users");
  });
});
