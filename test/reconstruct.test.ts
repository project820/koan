import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KOAN_STATE_DIR, STATE_FILES } from "../src/core/constants.js";
import { ensureKoanProject } from "../src/core/project.js";
import { reconstructFromDocuments, type ReconstructionResult } from "../src/core/reconstruct.js";
import { goalIdFromDate } from "../src/core/session.js";
import { type AmbiguityAxis } from "../src/core/schemas.js";
import { withTempProject } from "./helpers/fs.js";

const ISO = "2026-06-11T00:00:00.000Z";

const placeholderGoal = [
  "# Goal",
  "",
  "## Active Goal",
  "",
  '<!-- koan:section:start name="active-goal" -->',
  "No active goal yet.",
  '<!-- koan:section:end name="active-goal" -->',
  ""
].join("\n");

const filledGoal = [
  "# Goal",
  "",
  "## Active Goal",
  "",
  '<!-- koan:section:start name="active-goal" -->',
  "Build a CLI that tracks shared reading lists.",
  '<!-- koan:section:end name="active-goal" -->',
  ""
].join("\n");

const filledPlan = [
  "# Plan",
  "",
  '<!-- koan:section:start name="implementation-plan" -->',
  "1. Parse the list file. 2. Render the report.",
  '<!-- koan:section:end name="implementation-plan" -->',
  ""
].join("\n");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function clarityOf(result: ReconstructionResult, axis: AmbiguityAxis): number {
  return result.ledger.axes.find((entry) => entry.axis === axis)?.clarity ?? -1;
}

function evidenceOf(result: ReconstructionResult, axis: AmbiguityAxis): string[] {
  return result.ledger.axes.find((entry) => entry.axis === axis)?.evidence ?? [];
}

describe("reconstructFromDocuments", () => {
  it("returns null when koan/goal.md does not exist", async () => {
    await withTempProject(async (root) => {
      expect(await reconstructFromDocuments(root, ISO)).toBeNull();
    });
  });

  it("grants nothing for freshly initialized placeholder documents", async () => {
    await withTempProject(async (root) => {
      await ensureKoanProject(root);

      const result = await reconstructFromDocuments(root, ISO);
      expect(result).not.toBeNull();
      expect(result!.sources).toEqual([]);
      expect(result!.ledger.axes.every((entry) => entry.clarity === 0)).toBe(true);
      expect(result!.ledger.goalId).toBe(goalIdFromDate(ISO));
      expect(result!.state.activeGoalId).toBe(goalIdFromDate(ISO));
      expect(result!.state.phase).toBe("questioning");
      expect(result!.state.answers).toEqual([]);
    });
  });

  it("grants purpose, current_goal, and implementation_plan from filled sections", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, "koan"), { recursive: true });
      await writeFile(join(root, "koan/goal.md"), filledGoal, "utf8");
      await writeFile(join(root, "koan/plan.md"), filledPlan, "utf8");

      const result = await reconstructFromDocuments(root, ISO);
      expect(result!.sources).toEqual(["koan/goal.md", "koan/plan.md"]);
      expect(clarityOf(result!, "purpose")).toBe(0.5);
      expect(clarityOf(result!, "current_goal")).toBe(0.5);
      expect(clarityOf(result!, "implementation_plan")).toBe(0.5);
      expect(evidenceOf(result!, "purpose")).toEqual(["reconstructed from koan/goal.md"]);
      expect(evidenceOf(result!, "current_goal")).toEqual(["reconstructed from koan/goal.md"]);
      expect(evidenceOf(result!, "implementation_plan")).toEqual(["reconstructed from koan/plan.md"]);
      expect(clarityOf(result!, "scope")).toBe(0);
    });
  });

  it("grants qa_criteria and philosophical_intent when lazy documents exist", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, "koan"), { recursive: true });
      await writeFile(join(root, "koan/goal.md"), placeholderGoal, "utf8");
      await writeFile(join(root, "koan/qa.md"), "# QA Checklist\n", "utf8");
      await writeFile(join(root, "koan/philosophy.md"), "# Philosophy\n", "utf8");

      const result = await reconstructFromDocuments(root, ISO);
      expect(result!.sources).toEqual(["koan/qa.md", "koan/philosophy.md"]);
      expect(clarityOf(result!, "qa_criteria")).toBe(0.5);
      expect(clarityOf(result!, "philosophical_intent")).toBe(0.5);
      expect(evidenceOf(result!, "qa_criteria")).toEqual(["reconstructed from koan/qa.md"]);
      expect(evidenceOf(result!, "philosophical_intent")).toEqual(["reconstructed from koan/philosophy.md"]);
      expect(clarityOf(result!, "purpose")).toBe(0);
    });
  });

  it("never writes to disk", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, "koan"), { recursive: true });
      await writeFile(join(root, "koan/goal.md"), filledGoal, "utf8");
      await writeFile(join(root, "koan/qa.md"), "# QA Checklist\n", "utf8");

      const result = await reconstructFromDocuments(root, ISO);
      expect(result).not.toBeNull();
      expect(await exists(join(root, STATE_FILES.sessionState))).toBe(false);
      expect(await exists(join(root, STATE_FILES.ambiguityLedger))).toBe(false);
      expect(await exists(join(root, KOAN_STATE_DIR))).toBe(false);
    });
  });

  it("grants handoff readiness from a filled status document", async () => {
    await withTempProject(async (root) => {
      await ensureKoanProject(root);
      const statusDoc = [
        "# Status",
        "",
        '<!-- koan:section:start name="current-status" -->',
        "Implemented the parser; rendering remains.",
        '<!-- koan:section:end name="current-status" -->',
        ""
      ].join("\n");
      await writeFile(join(root, "koan/status.md"), statusDoc, "utf8");

      const result = await reconstructFromDocuments(root, ISO);
      expect(result?.sources).toContain("koan/status.md");
      expect(result?.ledger.axes.find((entry) => entry.axis === "handoff_readiness")?.clarity).toBe(0.5);
    });
  });
});
