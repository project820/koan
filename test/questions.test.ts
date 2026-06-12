import { describe, expect, it } from "vitest";
import {
  createInitialLedger,
  isConverged,
  selectMostUnclearAxis,
  unresolvedAxes,
  updateAxisScore
} from "../src/core/scoring.js";
import { getQuestion } from "../src/core/questions.js";
import { defaultProfile } from "../src/core/profile.js";
import { AmbiguityAxisSchema, SessionStateSchema } from "../src/core/schemas.js";

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

  it("asks why-layer questions that go beyond surface features", () => {
    const purpose = getQuestion("purpose", defaultProfile({ developmentUnderstanding: "non_technical", language: "en" }));
    expect(purpose.userFacingQuestion).toContain("possible");

    const philosophy = getQuestion("philosophical_intent", defaultProfile({ developmentUnderstanding: "intermediate", language: "en" }));
    expect(philosophy.userFacingQuestion).toContain("never damage");

    const expertPhilosophy = getQuestion("philosophical_intent", defaultProfile({ developmentUnderstanding: "expert", language: "en" }));
    expect(expertPhilosophy.userFacingQuestion).toContain("philosophy");
  });
});

describe("scoring", () => {
  it("starts with all axes unclear", () => {
    const ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    expect(ledger.axes).toHaveLength(11);
    expect(selectMostUnclearAxis(ledger)).toBe("purpose");
  });

  it("keeps the why layer first: philosophical_intent follows purpose in a fresh session", () => {
    const ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    const afterPurpose = updateAxisScore(ledger, "purpose", 0.9, "User explained purpose.", "2026-06-11T00:01:00.000Z");
    expect(selectMostUnclearAxis(afterPurpose)).toBe("philosophical_intent");

    const afterPhilosophy = updateAxisScore(
      afterPurpose,
      "philosophical_intent",
      0.9,
      "User explained philosophy.",
      "2026-06-11T00:02:00.000Z"
    );
    expect(selectMostUnclearAxis(afterPhilosophy)).toBe("current_goal");
  });

  it("reports convergence only when every axis meets the threshold", () => {
    let ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    expect(isConverged(ledger, 0.7)).toBe(false);

    for (const axis of AmbiguityAxisSchema.options) {
      ledger = updateAxisScore(ledger, axis, 0.7, "Answered.", "2026-06-11T00:01:00.000Z");
    }
    expect(isConverged(ledger, 0.7)).toBe(true);

    const dipped = updateAxisScore(ledger, "scope", 0.69, "Scope reopened.", "2026-06-11T00:02:00.000Z");
    expect(isConverged(dipped, 0.7)).toBe(false);
    expect(isConverged(dipped, 0.69)).toBe(true);
  });

  it("lists unresolved axes most unclear first with why-layer priority ties", () => {
    let ledger = createInitialLedger("goal-1", "2026-06-11T00:00:00.000Z");
    ledger = updateAxisScore(ledger, "purpose", 0.9, "Clear purpose.", "2026-06-11T00:01:00.000Z");
    ledger = updateAxisScore(ledger, "scope", 0.3, "Partial scope.", "2026-06-11T00:02:00.000Z");
    ledger = updateAxisScore(ledger, "current_goal", 0.3, "Partial goal.", "2026-06-11T00:03:00.000Z");
    ledger = updateAxisScore(ledger, "constraints", 0.1, "Vague constraints.", "2026-06-11T00:04:00.000Z");

    expect(unresolvedAxes(ledger, 0.7)).toEqual([
      "philosophical_intent",
      "target_users",
      "non_goals",
      "success_criteria",
      "implementation_plan",
      "qa_criteria",
      "handoff_readiness",
      "constraints",
      "current_goal",
      "scope"
    ]);
    expect(unresolvedAxes(ledger, 0)).toEqual([]);
  });
});

describe("session state schema", () => {
  it("parses old session state without answers and yields an empty list", () => {
    const parsed = SessionStateSchema.parse({
      version: 1,
      sessionId: "session-1",
      activeGoalId: "goal-1",
      phase: "questioning",
      lastQuestionId: null,
      updatedAt: "2026-06-11T00:00:00.000Z"
    });
    expect(parsed.answers).toEqual([]);
  });
});
