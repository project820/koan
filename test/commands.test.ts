import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hello, status, brightIdea, qa, handoff } from "../src/core/commands.js";
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
});
