import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordAnswer } from "../src/core/answers.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { hello, status, brightIdea, qa, handoff, archive } from "../src/core/commands.js";
import { STATE_FILES } from "../src/core/constants.js";
import { replaceManagedRegion } from "../src/core/documents.js";
import { getProfilePath } from "../src/core/profile.js";
import { loadProfileRef } from "../src/core/profileRef.js";
import { loadLedger } from "../src/core/scoring.js";
import { archiveGoal } from "../src/core/session.js";
import { withTempProject } from "./helpers/fs.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("core commands", () => {
  it("hello initializes project and returns first question", async () => {
    await withTempProject(async (root) => {
      const result = await hello({ cwd: root, homeDir: root });
      expect(result.projectRoot).toBe(root);
      expect(result.nextQuestion?.axis).toBe("purpose");
      expect(result.resumed).toBe(false);
      expect(result.reconstructed).toBe(false);
      expect(await exists(join(root, "koan/goal.md"))).toBe(true);
    });
  });

  it("status is read-only by default", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await status({ cwd: root });
      expect(result.summary).toContain("Active Goal");
      expect(result.didWrite).toBe(false);
    });
  });

  it("bright idea creates lazy document without changing plan", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const before = await readFile(join(root, "koan/plan.md"), "utf8");
      await brightIdea({ cwd: root, idea: "Support GUI handoff in the future." });
      const after = await readFile(join(root, "koan/plan.md"), "utf8");
      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(after).toBe(before);
      expect(ideas).toContain("Support GUI handoff");
    });
  });

  it("qa creates checklist document", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await qa({ cwd: root });
      const text = await readFile(join(root, "koan/qa.md"), "utf8");
      expect(text).toContain("Spec Compliance");
      expect(text).toContain("General Quality");
    });
  });

  it("handoff creates document-based handoff", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await handoff({ cwd: root, summary: "Next agent should continue Task 1." });
      const text = await readFile(join(root, "koan/handoff.md"), "utf8");
      expect(text).toContain("Next agent should continue Task 1.");
    });
  });

  it("handoff exposes disabled experimental metadata in document text", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await handoff({ cwd: root, summary: "Continue from status." });
      const text = await readFile(join(root, "koan/handoff.md"), "utf8");
      expect(text).toContain("MVP status: disabled");
      expect(text).toContain("document-based");
    });
  });

  it("hello writes the profile ref and logs the command", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      expect(await exists(join(root, STATE_FILES.userProfileRef))).toBe(true);
      const ref = await loadProfileRef(root);
      expect(ref).toEqual({ version: 1, profilePath: getProfilePath(root), overrides: {} });
      const log = await loadCommandLog(root);
      expect(log.entries.map((entry) => entry.command)).toEqual(["koan hello"]);
    });
  });

  it("bright idea keeps a single header across reruns", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await brightIdea({ cwd: root, idea: "First idea." });
      await brightIdea({ cwd: root, idea: "Second idea." });
      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas.match(/^# Bright Ideas$/gm)).toHaveLength(1);
      expect(ideas.match(/^## .+ — koan bright-idea$/gm)).toHaveLength(2);
      expect(ideas).toContain("First idea.");
      expect(ideas).toContain("Second idea.");
    });
  });

  it("write commands append command log entries", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await brightIdea({ cwd: root, idea: "Track this." });
      await qa({ cwd: root });
      await handoff({ cwd: root, summary: "Continue Task 1." });
      const log = await loadCommandLog(root);
      expect(log.entries.map((entry) => entry.command)).toEqual([
        "koan hello",
        "koan bright-idea",
        "koan qa",
        "koan handoff"
      ]);
    });
  });

  it("status does not create or grow the command log", async () => {
    await withTempProject(async (root) => {
      await status({ cwd: root });
      expect(await exists(join(root, STATE_FILES.commandLog))).toBe(false);

      await hello({ cwd: root, homeDir: root });
      const before = await readFile(join(root, STATE_FILES.commandLog), "utf8");
      await status({ cwd: root });
      const after = await readFile(join(root, STATE_FILES.commandLog), "utf8");
      expect(after).toBe(before);
    });
  });

  it("archives a completed goal and clears the active goal", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await archiveGoal(root, "goal-example");
      const archived = await readFile(join(root, "koan/archive/goal-example/goal.md"), "utf8");
      const active = await readFile(join(root, "koan/goal.md"), "utf8");
      expect(archived).toContain("# Goal");
      expect(active).toContain("No active goal yet");
      expect(active).toContain("Archived goal: goal-example");
    });
  });

  it("bright idea on a bare project creates the state gitignore atomically", async () => {
    await withTempProject(async (root) => {
      await brightIdea({ cwd: root, idea: "Standalone idea." });
      const gitignore = await readFile(join(root, STATE_FILES.gitignore), "utf8");
      expect(gitignore).toContain("command-log.json");
      const log = await loadCommandLog(root);
      expect(log.entries.map((entry) => entry.command)).toEqual(["koan bright-idea"]);
    });
  });

  it("hello resumes an existing session and preserves the ledger", async () => {
    await withTempProject(async (root) => {
      const first = await hello({ cwd: root, homeDir: root });
      expect(first.resumed).toBe(false);
      await recordAnswer({
        cwd: root,
        homeDir: root,
        axis: "purpose",
        answer: "Keep coding agents aligned with the project's intent."
      });
      const second = await hello({ cwd: root, homeDir: root });
      expect(second.resumed).toBe(true);
      expect(second.reconstructed).toBe(false);
      expect(second.lastAnswer?.axis).toBe("purpose");
      const ledger = await loadLedger(root);
      expect(ledger?.axes.find((entry) => entry.axis === "purpose")?.clarity).toBe(0.8);
    });
  });

  it("hello reconstructs from documents when session state is missing", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const goalPath = join(root, "koan/goal.md");
      const goalDoc = await readFile(goalPath, "utf8");
      await writeFile(
        goalPath,
        replaceManagedRegion(goalDoc, "active-goal", "Ship a CLI that keeps coding agents aligned with project intent."),
        "utf8"
      );
      await rm(join(root, STATE_FILES.sessionState));

      const result = await hello({ cwd: root, homeDir: root });
      expect(result.resumed).toBe(false);
      expect(result.reconstructed).toBe(true);
      const ledger = await loadLedger(root);
      expect(ledger?.axes.find((entry) => entry.axis === "purpose")?.clarity).toBe(0.5);
    });
  });

  it("archive archives the active goal and logs the command", async () => {
    await withTempProject(async (root) => {
      const first = await hello({ cwd: root, homeDir: root });
      const result = await archive({ cwd: root });
      expect(result.archivedGoalId).toBe(first.activeGoalId);
      expect(await exists(join(root, `koan/archive/${result.archivedGoalId}/goal.md`))).toBe(true);

      const log = await loadCommandLog(root);
      expect(log.entries.at(-1)?.command).toBe("koan archive");

      const after = await status({ cwd: root });
      expect(after.nextAction).toMatch(/koan (hello|archive)/);
    });
  });

  it("archive without an active goal throws", async () => {
    await withTempProject(async (root) => {
      await expect(archive({ cwd: root })).rejects.toThrow("No active goal to archive.");
    });
  });

  it("status nextAction points at the purpose question on a fresh project", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await status({ cwd: root });
      expect(result.nextAction).toContain("purpose");
      expect(result.nextAction).toContain("axes unresolved");
      expect(result.summary).toContain(`Next action: ${result.nextAction}`);
      expect(result.didWrite).toBe(false);
    });
  });
});
