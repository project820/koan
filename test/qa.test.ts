import { describe, expect, it } from "vitest";
import { buildQaChecklist } from "../src/core/qa.js";

describe("buildQaChecklist", () => {
  it("renders the base checklist when context is empty", () => {
    const text = buildQaChecklist();
    expect(text).toContain("Spec Compliance");
    expect(text).toContain("General Quality");
    expect(text).toContain("MCP Host Agent Prompt");
    expect(text).not.toContain("Active Goal Under Review");
    expect(text).not.toContain("Plan-Derived Checks");
  });

  it("treats explicit null context the same as the default", () => {
    expect(buildQaChecklist({ activeGoal: null, planSection: null })).toBe(buildQaChecklist());
  });

  it("inserts the active goal section after the QA heading", () => {
    const text = buildQaChecklist({ activeGoal: "Ship the Koan MVP CLI.", planSection: null });
    expect(text).toContain("# QA\n\n## Active Goal Under Review\n\nShip the Koan MVP CLI.\n\n## Spec Compliance");
  });

  it("derives checkboxes from plan lines without list markers", () => {
    const text = buildQaChecklist({ activeGoal: null, planSection: "1. Parse input\n2. Render output" });
    expect(text).toContain("## Plan-Derived Checks");
    expect(text).toContain("- [ ] Parse input");
    expect(text).toContain("- [ ] Render output");
    expect(text).not.toContain("1. Parse input");
    expect(text).not.toContain("2. Render output");
  });

  it("strips dash and star list markers from plan lines", () => {
    const text = buildQaChecklist({ activeGoal: null, planSection: "- Parse input\n* Render output\n\n" });
    expect(text).toContain("- [ ] Parse input");
    expect(text).toContain("- [ ] Render output");
    expect(text).not.toContain("- [ ] - ");
    expect(text).not.toContain("- [ ] * ");
  });

  it("ignores placeholder goal and plan content", () => {
    const text = buildQaChecklist({
      activeGoal: "No active goal yet.\n\nArchived goal: goal-example",
      planSection: "No implementation plan recorded yet."
    });
    expect(text).toBe(buildQaChecklist());
    expect(text).not.toContain("Active Goal Under Review");
    expect(text).not.toContain("Plan-Derived Checks");
  });
});
