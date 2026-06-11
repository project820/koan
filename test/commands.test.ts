import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptClarity, recordAnswer } from "../src/core/answers.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { hello, status, updateStatus, brightIdea, qa, handoff, archive } from "../src/core/commands.js";
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
      await rm(join(root, STATE_FILES.ambiguityLedger));

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
      expect(after.nextAction).toBe("run koan hello to start a new goal");
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

  it("hello after archive rotates to a fresh goal", async () => {
    await withTempProject(async (root) => {
      const first = await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Old goal purpose." });
      await archive({ cwd: root });

      const second = await hello({ cwd: root, homeDir: root });
      expect(second.resumed).toBe(false);
      expect(second.activeGoalId).not.toBeNull();
      expect(second.activeGoalId).not.toBe(first.activeGoalId);
      expect(second.lastAnswer).toBeNull();

      const one = await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "New purpose." });
      const two = await recordAnswer({ cwd: root, homeDir: root, axis: "target_users", answer: "New users." });
      expect(two.ledger.goalId).toBe(one.ledger.goalId);
      expect(two.ledger.axes.find((entry) => entry.axis === "purpose")?.clarity).toBe(0.8);
      expect(two.ledger.axes.find((entry) => entry.axis === "target_users")?.clarity).toBe(0.8);
    });
  });

  it("recordAnswer after archive throws until a new goal starts", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await archive({ cwd: root });
      await expect(
        recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Too late." })
      ).rejects.toThrow("No active goal");
    });
  });

  it("honors a non-default convergence threshold end to end", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const configPath = join(root, ".koan/project.json");
      const config = JSON.parse(await readFile(configPath, "utf8"));
      config.settings = { convergenceThreshold: 0.9 };
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

      const axes = [
        "purpose", "target_users", "current_goal", "scope", "non_goals", "constraints",
        "success_criteria", "philosophical_intent", "implementation_plan", "qa_criteria",
        "handoff_readiness"
      ] as const;
      let last;
      for (const axis of axes) {
        last = await recordAnswer({ cwd: root, homeDir: root, axis, answer: `Answer for ${axis}.` });
      }
      expect(last?.converged).toBe(false);
      expect(last?.unresolved).toHaveLength(11);
      expect((await status({ cwd: root })).nextAction).toContain("axes unresolved");
    });
  });

  it("acceptClarity marks the session ready and status recommends archival", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await acceptClarity({ cwd: root });
      const result = await status({ cwd: root });
      expect(result.nextAction).toBe("archive the completed goal (koan archive)");
      const log = await loadCommandLog(root);
      expect(log.entries.at(-1)?.command).toBe("koan enough");
    });
  });

  it("hello recovers a surviving ledger when session state is lost", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Keep this evidence." });
      await rm(join(root, STATE_FILES.sessionState));

      const result = await hello({ cwd: root, homeDir: root });
      expect(result.reconstructed).toBe(false);
      expect(result.resumed).toBe(false);
      const ledger = await loadLedger(root);
      expect(ledger?.goalId).toBe(result.activeGoalId);
      expect(ledger?.axes.find((entry) => entry.axis === "purpose")?.clarity).toBe(0.8);
    });
  });

  it("status falls back to hello when the ledger belongs to another goal", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const statePath = join(root, STATE_FILES.sessionState);
      const state = JSON.parse(await readFile(statePath, "utf8"));
      state.activeGoalId = "goal-someone-else";
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const result = await status({ cwd: root });
      expect(result.nextAction).toBe("run koan hello");
    });
  });

  it("archive removes the archived goal's ledger and blocks resurrection", async () => {
    await withTempProject(async (root) => {
      const first = await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Old goal." });
      await archive({ cwd: root });
      expect(await exists(join(root, STATE_FILES.ambiguityLedger))).toBe(false);

      await rm(join(root, STATE_FILES.sessionState));
      const revived = await hello({ cwd: root, homeDir: root });
      expect(revived.reconstructed).toBe(false);
      expect(revived.activeGoalId).not.toBe(first.activeGoalId);
      const ledger = await loadLedger(root);
      expect(ledger?.axes.find((entry) => entry.axis === "purpose")?.clarity).toBe(0);
    });
  });

  it("hello resume honors an accepted-clarity ready session", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await acceptClarity({ cwd: root });
      const resumed = await hello({ cwd: root, homeDir: root });
      expect(resumed.resumed).toBe(true);
      expect(resumed.converged).toBe(true);
      expect(resumed.nextQuestion).toBeNull();
    });
  });

  it("updateStatus writes status and handoff regions and bumps session state", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const isoDate = "2026-06-11T00:00:00.000Z";
      const result = await updateStatus({ cwd: root, update: "  Implemented the parser.  ", isoDate });
      expect(result.projectRoot).toBe(root);

      const statusDoc = await readFile(join(root, "koan/status.md"), "utf8");
      expect(statusDoc).toContain('name="current-status"');
      expect(statusDoc).toContain("Implemented the parser.");
      expect(statusDoc).not.toContain("No status recorded yet.");

      const handoffDoc = await readFile(join(root, "koan/handoff.md"), "utf8");
      expect(handoffDoc).toContain("# Handoff");
      expect(handoffDoc).toContain('name="latest-status"');
      expect(handoffDoc).toContain("Implemented the parser.");
      expect(handoffDoc).toContain(`(Updated ${isoDate} via koan status)`);

      const state = JSON.parse(await readFile(join(root, STATE_FILES.sessionState), "utf8"));
      expect(state.updatedAt).toBe(isoDate);

      const log = await loadCommandLog(root);
      expect(log.entries.filter((entry) => entry.command === "koan status")).toHaveLength(1);
      expect(log.entries.at(-1)?.summary).toBe("Recorded a status update.");
    });
  });

  it("updateStatus without a session throws", async () => {
    await withTempProject(async (root) => {
      await expect(updateStatus({ cwd: root, update: "Anything." })).rejects.toThrow(
        "No active Koan session. Run koan hello first."
      );
    });
  });

  it("updateStatus rejects empty update text", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await expect(updateStatus({ cwd: root, update: "   " })).rejects.toThrow(
        "Status update text is required."
      );
    });
  });

  it("status warns when session state is stale", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const statePath = join(root, STATE_FILES.sessionState);
      const state = JSON.parse(await readFile(statePath, "utf8"));
      state.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const result = await status({ cwd: root });
      expect(result.staleWarnings).toContain(`session state is stale (last updated ${state.updatedAt})`);
      expect(result.summary).toContain("Warnings:");
      expect(result.summary).toContain(`- session state is stale (last updated ${state.updatedAt})`);
      expect(result.didWrite).toBe(false);
    });
  });

  it("status warns when recorded answers are not crystallized", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Keep agents aligned." });
      const result = await status({ cwd: root });
      expect(result.staleWarnings).toContain("recorded answers are not crystallized yet (run koan crystallize)");
      expect(result.summary).toContain("- recorded answers are not crystallized yet (run koan crystallize)");
    });
  });

  it("status reports no warnings on a fresh session", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await status({ cwd: root });
      expect(result.staleWarnings).toEqual([]);
      expect(result.summary).not.toContain("Warnings:");
    });
  });

  it("brightIdea defaults to follow-up and records the classification", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await brightIdea({ cwd: root, idea: "Add a TUI later." });
      expect(result.classification).toBe("follow-up");
      expect(result.recommendation).toBe("Keep the current plan; revisit this after the active goal completes.");
      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Classification: follow-up");
      expect(ideas).toContain("Add a TUI later.");
    });
  });

  it("brightIdea records a custom classification with its recommendation", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await brightIdea({ cwd: root, idea: "Rewrite everything in Rust.", classification: "reject" });
      expect(result.classification).toBe("reject");
      expect(result.recommendation).toBe("Recorded for reference; no action planned.");
      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Classification: reject");
      expect(ideas).toContain("Rewrite everything in Rust.");
    });
  });

  it("qa includes the active goal section when goal.md is crystallized", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const goalPath = join(root, "koan/goal.md");
      const goalDoc = await readFile(goalPath, "utf8");
      await writeFile(
        goalPath,
        replaceManagedRegion(goalDoc, "active-goal", "Ship the Koan MVP CLI."),
        "utf8"
      );
      await qa({ cwd: root });
      const text = await readFile(join(root, "koan/qa.md"), "utf8");
      expect(text).toContain("Active Goal Under Review");
      expect(text).toContain("Ship the Koan MVP CLI.");
    });
  });
});
