import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordAnswer } from "../src/core/answers.js";
import { archive, hello } from "../src/core/commands.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { crystallize } from "../src/core/crystallize.js";
import { readManagedSection } from "../src/core/documents.js";
import { defaultProfile } from "../src/core/profile.js";
import { getQuestion } from "../src/core/questions.js";
import { type AmbiguityAxis } from "../src/core/schemas.js";
import { readText, withTempProject } from "./helpers/fs.js";

const ISO = "2026-06-11T00:00:00.000Z";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("crystallize", () => {
  it("throws when no session exists", async () => {
    await withTempProject(async (root) => {
      await expect(crystallize({ cwd: root, homeDir: root })).rejects.toThrow(
        "No active Koan session. Run koan hello first."
      );
    });
  });

  it("throws after the goal is archived", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await archive({ cwd: root });
      await expect(crystallize({ cwd: root, homeDir: root })).rejects.toThrow(
        "No active goal. Run koan hello first."
      );
    });
  });

  it("crystallizes answers into managed regions, audit trail, and open questions", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });

      const goalPath = join(root, "koan/goal.md");
      await writeFile(goalPath, `${await readText(goalPath)}\nManual user note.\n`, "utf8");

      const purposeAnswer = "Keep coding agents aligned with the project's original intent.";
      const goalAnswer = "Ship the crystallization core for Stage 3.";
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: purposeAnswer });
      await recordAnswer({ cwd: root, homeDir: root, axis: "current_goal", answer: goalAnswer });

      const result = await crystallize({ cwd: root, homeDir: root, isoDate: ISO });

      expect(result.executed).toBe(true);
      expect(result.crystallizedAxes).toEqual(["current_goal", "purpose"]);
      expect(result.files).toEqual(["koan/goal.md", "koan/open-questions.md", "koan/decisions.md"]);
      expect(result.plan.description).toBe("Crystallize recorded answers into project documents");

      const goalText = await readText(goalPath);
      expect(readManagedSection(goalText, "active-goal")).toBe(goalAnswer);
      expect(readManagedSection(goalText, "purpose")).toBe(purposeAnswer);
      expect(goalText).toContain("Manual user note.");

      const decisionsText = await readText(join(root, "koan/decisions.md"));
      expect(decisionsText.startsWith("# Decisions")).toBe(true);
      expect(decisionsText).toContain(`## ${ISO} — koan crystallize`);
      expect(decisionsText).toContain("Crystallized axes: current_goal, purpose.");

      const openText = await readText(join(root, "koan/open-questions.md"));
      expect(openText.startsWith("# Open Questions")).toBe(true);
      const region = readManagedSection(openText, "open-questions");
      const lines = region?.split("\n") ?? [];
      const expectedAxes: AmbiguityAxis[] = [
        "target_users",
        "scope",
        "non_goals",
        "constraints",
        "success_criteria",
        "philosophical_intent",
        "implementation_plan",
        "qa_criteria",
        "handoff_readiness"
      ];
      expect(lines).toHaveLength(9);
      for (const [index, axis] of expectedAxes.entries()) {
        expect(lines[index]).toBe(`- ${axis}: ${getQuestion(axis, defaultProfile()).userFacingQuestion}`);
      }

      const log = await loadCommandLog(root);
      expect(log.entries.at(-1)?.command).toBe("koan crystallize");
      expect(log.entries.at(-1)?.summary).toBe("Crystallized 2 axes.");
    });
  });

  it("bootstraps philosophy.md with its header before the managed region", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const answer = "Clarity should survive every implementation tradeoff.";
      await recordAnswer({ cwd: root, homeDir: root, axis: "philosophical_intent", answer });

      const result = await crystallize({ cwd: root, homeDir: root, isoDate: ISO });

      expect(result.plan.operations[0]).toEqual({
        type: "write",
        path: "koan/philosophy.md",
        content: "# Philosophy\n"
      });
      const text = await readText(join(root, "koan/philosophy.md"));
      expect(text.startsWith("# Philosophy")).toBe(true);
      expect(readManagedSection(text, "philosophy")).toBe(answer);
    });
  });

  it("dry run returns the same plan without writing or logging", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Stay aligned." });

      const goalPath = join(root, "koan/goal.md");
      const before = await readText(goalPath);

      const dry = await crystallize({ cwd: root, homeDir: root, dryRun: true, isoDate: ISO });
      expect(dry.executed).toBe(false);
      expect(dry.plan.operations.length).toBeGreaterThan(0);
      expect(await readText(goalPath)).toBe(before);
      expect(await exists(join(root, "koan/decisions.md"))).toBe(false);
      expect(await exists(join(root, "koan/open-questions.md"))).toBe(false);
      const log = await loadCommandLog(root);
      expect(log.entries.some((entry) => entry.command === "koan crystallize")).toBe(false);

      const real = await crystallize({ cwd: root, homeDir: root, isoDate: ISO });
      expect(real.plan).toEqual(dry.plan);
      expect(real.executed).toBe(true);
      expect(await readText(goalPath)).not.toBe(before);
    });
  });

  it("the latest answer per axis wins", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "First draft purpose." });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Final purpose." });

      const result = await crystallize({ cwd: root, homeDir: root, isoDate: ISO });

      expect(result.crystallizedAxes).toEqual(["purpose"]);
      const goalText = await readText(join(root, "koan/goal.md"));
      expect(readManagedSection(goalText, "purpose")).toBe("Final purpose.");
      expect(goalText).not.toContain("First draft purpose.");
    });
  });

  it("does nothing when no answers are recorded", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });

      const result = await crystallize({ cwd: root, homeDir: root, isoDate: ISO });

      expect(result.executed).toBe(false);
      expect(result.plan.operations).toEqual([]);
      expect(result.files).toEqual([]);
      expect(result.crystallizedAxes).toEqual([]);
      expect(await exists(join(root, "koan/decisions.md"))).toBe(false);
      expect(await exists(join(root, "koan/open-questions.md"))).toBe(false);
      const log = await loadCommandLog(root);
      expect(log.entries.some((entry) => entry.command === "koan crystallize")).toBe(false);
    });
  });

  it("open questions become None when every axis resolves", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Purpose.", clarity: 1 });
      await crystallize({ cwd: root, homeDir: root });

      const axes = [
        "target_users", "current_goal", "scope", "non_goals", "constraints",
        "success_criteria", "philosophical_intent", "implementation_plan", "qa_criteria",
        "handoff_readiness"
      ] as const;
      for (const axis of axes) {
        await recordAnswer({ cwd: root, homeDir: root, axis, answer: `Answer ${axis}.`, clarity: 1 });
      }
      await crystallize({ cwd: root, homeDir: root });

      const text = await readText(join(root, "koan/open-questions.md"));
      expect(readManagedSection(text, "open-questions")).toBe("None.");
    });
  });
});
