import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordAnswer } from "../src/core/answers.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { hello, recordInsight } from "../src/core/commands.js";
import { readManagedSection } from "../src/core/documents.js";
import { adapterFor } from "../src/core/hostAdapter.js";
import { PRD_SECTIONS, buildPrd, parseInsights } from "../src/core/prd.js";
import { withTempProject } from "./helpers/fs.js";

const ISO = "2026-06-12T00:00:00.000Z";

async function readPrd(root: string): Promise<string> {
  return readFile(join(root, "koan/prd.md"), "utf8");
}

describe("buildPrd", () => {
  it("requires an active session", async () => {
    await withTempProject(async (root) => {
      await expect(buildPrd({ cwd: root, homeDir: root })).rejects.toThrow("No active Koan session");
    });
  });

  it("assembles deterministic sections in §10 order with placeholders for the rest", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Make loneliness shareable." });
      await recordAnswer({ cwd: root, homeDir: root, axis: "scope", answer: "Async sharing rooms only." });

      const result = await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });
      expect(result.executed).toBe(true);
      expect(result.path).toBe("koan/prd.md");

      const text = await readPrd(root);
      expect(text.startsWith("# PRD")).toBe(true);

      const titles = PRD_SECTIONS.map((section) => `## ${section.title}`);
      let cursor = -1;
      for (const title of titles) {
        const index = text.indexOf(title);
        expect(index).toBeGreaterThan(cursor);
        cursor = index;
      }

      expect(readManagedSection(text, "scope")).toBe("Async sharing rooms only.");
      expect(readManagedSection(text, "vision")).toBe("Make loneliness shareable.");
      expect(readManagedSection(text, "philosophy")).toContain("Not yet clarified");
      expect(readManagedSection(text, "user-stories")).toContain("Pending host synthesis.");
      expect(readManagedSection(text, "residual-ambiguity")).toContain("`philosophical_intent`");

      const log = await loadCommandLog(root);
      expect(log.entries.at(-1)?.command).toBe("koan prd");
    });
  });

  it("folds recorded insights into the philosophy section", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({
        cwd: root,
        homeDir: root,
        axis: "philosophical_intent",
        answer: "Quiet sharing beats engagement metrics."
      });
      await recordInsight({ cwd: root, text: "The real product is a quiet room, not a feed.", isoDate: ISO });

      await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });
      const philosophy = readManagedSection(await readPrd(root), "philosophy");
      expect(philosophy).toContain("Quiet sharing beats engagement metrics.");
      expect(philosophy).toContain("- The real product is a quiet room, not a feed.");
      expect(philosophy).toContain("koan/philosophy.md");
    });
  });

  it("accepts host sections, keeps them across rebuilds, and never lets them shadow answers", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await recordAnswer({ cwd: root, homeDir: root, axis: "scope", answer: "Original scope answer." });

      await buildPrd({
        cwd: root,
        homeDir: root,
        isoDate: ISO,
        sections: { userStories: "As a lonely user, I share async notes safely." }
      });
      let text = await readPrd(root);
      expect(readManagedSection(text, "user-stories")).toBe("As a lonely user, I share async notes safely.");

      // Rebuild without sections: host content survives, deterministic re-derives.
      await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });
      text = await readPrd(root);
      expect(readManagedSection(text, "user-stories")).toBe("As a lonely user, I share async notes safely.");
      expect(readManagedSection(text, "scope")).toBe("Original scope answer.");
    });
  });

  it("dry run plans operations without writing", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await buildPrd({ cwd: root, homeDir: root, dryRun: true, isoDate: ISO });
      expect(result.executed).toBe(false);
      expect(result.document).toBeNull();
      expect(result.plan.operations.length).toBe(PRD_SECTIONS.length + 1);
      await expect(readPrd(root)).rejects.toThrow();
      const log = await loadCommandLog(root);
      expect(log.entries.some((entry) => entry.command === "koan prd")).toBe(false);
    });
  });

  it("preserves manual edits outside managed regions", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });

      const prdPath = join(root, "koan/prd.md");
      await writeFile(prdPath, `${await readFile(prdPath, "utf8")}\nManual reviewer note.\n`, "utf8");

      await recordAnswer({ cwd: root, homeDir: root, axis: "scope", answer: "Updated scope." });
      await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });

      const text = await readPrd(root);
      expect(text).toContain("Manual reviewer note.");
      expect(readManagedSection(text, "scope")).toBe("Updated scope.");
    });
  });

  it("embeds the host-specific synthesis instruction in pending placeholders", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      await buildPrd({ cwd: root, homeDir: root, host: "claude", isoDate: ISO });
      const text = await readPrd(root);
      expect(readManagedSection(text, "core-value")).toContain(adapterFor("claude").prdSynthesisInstruction);
    });
  });

  it("reports convergence in residual ambiguity once every axis resolves", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const axes = [
        "purpose", "philosophical_intent", "current_goal", "target_users", "scope", "non_goals",
        "constraints", "success_criteria", "implementation_plan", "qa_criteria", "handoff_readiness"
      ] as const;
      for (const axis of axes) {
        await recordAnswer({ cwd: root, homeDir: root, axis, answer: `Answer ${axis}.`, clarity: 1 });
      }
      await buildPrd({ cwd: root, homeDir: root, isoDate: ISO });
      expect(readManagedSection(await readPrd(root), "residual-ambiguity")).toBe("None.");
    });
  });
});

describe("parseInsights", () => {
  it("collects the first body line of each insight entry in order", () => {
    const text = [
      "# Philosophy",
      "",
      "Intro prose.",
      "",
      "## 2026-06-12T00:00:00.000Z — koan insight",
      "",
      "First realization.",
      "More detail.",
      "",
      "## 2026-06-12T00:01:00.000Z — koan insight",
      "",
      "Second realization.",
      "",
      "## 2026-06-12T00:02:00.000Z — koan bright-idea",
      "",
      "Not an insight."
    ].join("\n");
    expect(parseInsights(text)).toEqual(["First realization.", "Second realization."]);
  });

  it("returns an empty list for empty or insight-free text", () => {
    expect(parseInsights("")).toEqual([]);
    expect(parseInsights("# Philosophy\n\nJust prose.\n")).toEqual([]);
  });
});
