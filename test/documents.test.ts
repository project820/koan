import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withFileLock } from "../src/core/lock.js";
import { appendLogEntry, executeWritePlan, replaceManagedRegion } from "../src/core/documents.js";
import { readText, withTempProject } from "./helpers/fs.js";

describe("documents", () => {
  it("replaces only the named managed region", async () => {
    const input = [
      "User intro",
      "<!-- koan:section:start name=\"current-status\" -->",
      "Old status",
      "<!-- koan:section:end name=\"current-status\" -->",
      "User outro"
    ].join("\n");

    const output = replaceManagedRegion(input, "current-status", "New status");

    expect(output).toContain("User intro");
    expect(output).toContain("New status");
    expect(output).not.toContain("Old status");
    expect(output).toContain("User outro");
  });

  it("appends timestamped log entries", () => {
    const output = appendLogEntry("# Decisions\n", "koan bright-idea", "Captured new idea.", "2026-06-11T00:00:00.000Z");
    expect(output).toContain("## 2026-06-11T00:00:00.000Z — koan bright-idea");
    expect(output).toContain("Captured new idea.");
  });

  it("executes write plans through core", async () => {
    await withTempProject(async (root) => {
      await executeWritePlan(root, {
        description: "Write QA",
        operations: [{ type: "write", path: "koan/qa.md", content: "# QA\n" }]
      });
      expect(await readText(join(root, "koan/qa.md"))).toBe("# QA\n");
    });
  });

  it("prevents concurrent writes with a lock file", async () => {
    await withTempProject(async (root) => {
      let sawConflict = false;
      await withFileLock(root, async () => {
        try {
          await withFileLock(root, async () => undefined);
        } catch {
          sawConflict = true;
        }
      });
      expect(sawConflict).toBe(true);
    });
  });

  it("preserves text outside managed regions during write plan execution", async () => {
    await withTempProject(async (root) => {
      const target = join(root, "koan/status.md");
      await mkdir(join(root, "koan"), { recursive: true });
      await writeFile(target, "User note\n<!-- koan:section:start name=\"current-status\" -->\nOld\n<!-- koan:section:end name=\"current-status\" -->\n", "utf8");
      await executeWritePlan(root, {
        description: "Update status",
        operations: [{ type: "managed-region", path: "koan/status.md", name: "current-status", content: "New" }]
      });
      const output = await readFile(target, "utf8");
      expect(output).toContain("User note");
      expect(output).toContain("New");
      expect(output).not.toContain("Old");
    });
  });
});
