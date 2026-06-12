import { describe, expect, it } from "vitest";
import {
  AXIS_TOTAL,
  ONBOARDING_COPY,
  onboardingCopy,
  progressStep
} from "../src/cli/onboarding.js";
import { AmbiguityAxisSchema } from "../src/core/schemas.js";

const LANGUAGES = ["ko", "en", "mixed"] as const;

describe("ONBOARDING_COPY", () => {
  it("has identical key sets across ko, en, and mixed", () => {
    const koKeys = Object.keys(ONBOARDING_COPY.ko).sort();
    expect(koKeys.length).toBeGreaterThan(0);
    expect(Object.keys(ONBOARDING_COPY.en).sort()).toEqual(koKeys);
    expect(Object.keys(ONBOARDING_COPY.mixed).sort()).toEqual(koKeys);
  });

  it("explains the literal enough and stop commands in every language", () => {
    for (const language of LANGUAGES) {
      const transition = ONBOARDING_COPY[language].transition.join(" ");
      expect(transition).toContain("'enough'");
      expect(transition).toContain("'stop'");
    }
  });

  it("keeps the pre-language copy bilingual and identical across registers", () => {
    for (const language of LANGUAGES) {
      expect(ONBOARDING_COPY[language].welcome).toEqual(ONBOARDING_COPY.ko.welcome);
      expect(ONBOARDING_COPY[language].languagePrompt).toBe(ONBOARDING_COPY.ko.languagePrompt);
    }
    expect(ONBOARDING_COPY.ko.languagePrompt).toContain("한국어");
    expect(ONBOARDING_COPY.ko.languagePrompt).toContain("English");
  });

  it("builds the progress label as (axis · k/total)", () => {
    for (const language of LANGUAGES) {
      expect(ONBOARDING_COPY[language].progress("purpose", 1, AXIS_TOTAL)).toBe("(purpose · 1/11)");
    }
  });

  it("formats the answer ack with axis and clarity", () => {
    expect(ONBOARDING_COPY.en.answerAck("purpose", "0.8")).toBe("Recorded purpose (clarity 0.8).");
    expect(ONBOARDING_COPY.ko.answerAck("purpose", "0.8")).toBe("기록했어요 — purpose (clarity 0.8)");
  });

  it("looks up copy by language", () => {
    expect(onboardingCopy("en")).toBe(ONBOARDING_COPY.en);
    expect(onboardingCopy("mixed")).toBe(ONBOARDING_COPY.mixed);
    expect(onboardingCopy("ko")).toBe(ONBOARDING_COPY.ko);
  });
});

describe("progressStep", () => {
  const allAxes = AmbiguityAxisSchema.options;

  it("starts at 1 when every axis is unresolved", () => {
    expect(AXIS_TOTAL).toBe(allAxes.length);
    expect(progressStep(allAxes, "purpose")).toBe(1);
  });

  it("advances as axes resolve", () => {
    expect(progressStep(allAxes.slice(1), allAxes[1])).toBe(2);
    expect(progressStep([allAxes[10]], allAxes[10])).toBe(11);
  });

  it("counts a revised, already-resolved axis as its own step", () => {
    // Revising "purpose" while ten axes remain unresolved: purpose is not in
    // the unresolved list, so it is counted in addition to them.
    expect(progressStep(allAxes.slice(1), "purpose")).toBe(1);
  });

  it("never reports a step below 1", () => {
    expect(progressStep(allAxes, "not-an-axis")).toBe(1);
  });
});
