import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordAnswer } from "../src/core/answers.js";
import { hello, recordInsight } from "../src/core/commands.js";
import { collectDashboardSnapshot } from "../src/core/dashboard.js";
import { AXIS_PRIORITY } from "../src/core/scoring.js";
import { displayWidth, renderDashboard, truncateToWidth } from "../src/cli/dashboard.js";
import { withTempProject } from "./helpers/fs.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("collectDashboardSnapshot", () => {
  it("reports a bare project gracefully without creating any state", async () => {
    await withTempProject(async (root) => {
      const snapshot = await collectDashboardSnapshot({ cwd: root, homeDir: root });
      expect(snapshot.goalId).toBeNull();
      expect(snapshot.phase).toBeNull();
      expect(snapshot.nextQuestion).toBeNull();
      expect(snapshot.nextAction).toBe("run koan hello");
      expect(snapshot.axes.map((entry) => entry.axis)).toEqual([...AXIS_PRIORITY]);
      expect(snapshot.axes.every((entry) => entry.clarity === 0)).toBe(true);

      // Read-only proof: no koan/ documents, no .koan state, no command log.
      expect(await exists(join(root, "koan"))).toBe(false);
      expect(await exists(join(root, ".koan"))).toBe(false);
    });
  });

  it("tracks the session: priority order, clarity, next question, insights", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });

      let snapshot = await collectDashboardSnapshot({ cwd: root, homeDir: root });
      expect(snapshot.goalId).not.toBeNull();
      expect(snapshot.phase).toBe("questioning");
      expect(snapshot.nextQuestion?.axis).toBe("purpose");
      expect(snapshot.unresolvedCount).toBe(11);
      expect(snapshot.converged).toBe(false);

      await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Make intent durable." });
      await recordInsight({ cwd: root, text: "The product is a mirror, not a checklist." });

      snapshot = await collectDashboardSnapshot({ cwd: root, homeDir: root });
      expect(snapshot.axes[0]).toEqual({ axis: "purpose", clarity: 0.8 });
      expect(snapshot.nextQuestion?.axis).toBe("philosophical_intent");
      expect(snapshot.unresolvedCount).toBe(10);
      expect(snapshot.insights).toEqual(["The product is a mirror, not a checklist."]);
      expect(snapshot.lastCommand?.command).toBe("koan insight");
      expect(snapshot.staleWarnings.some((warning) => warning.includes("crystallize"))).toBe(true);
    });
  });

  it("reports convergence with no next question once every axis is answered", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      for (const axis of AXIS_PRIORITY) {
        await recordAnswer({ cwd: root, homeDir: root, axis, answer: `Answer ${axis}.`, clarity: 1 });
      }
      const snapshot = await collectDashboardSnapshot({ cwd: root, homeDir: root });
      expect(snapshot.converged).toBe(true);
      expect(snapshot.nextQuestion).toBeNull();
      expect(snapshot.unresolvedCount).toBe(0);
    });
  });

  it("does not grow the command log", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const before = await readFile(join(root, ".koan/command-log.json"), "utf8");
      await collectDashboardSnapshot({ cwd: root, homeDir: root });
      await collectDashboardSnapshot({ cwd: root, homeDir: root });
      expect(await readFile(join(root, ".koan/command-log.json"), "utf8")).toBe(before);
    });
  });
});

describe("renderDashboard", () => {
  async function sampleSnapshot(root: string) {
    await hello({ cwd: root, homeDir: root });
    await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Make intent durable." });
    return collectDashboardSnapshot({ cwd: root, homeDir: root });
  }

  it("renders bars, threshold, and the next marker without color codes when color is off", async () => {
    await withTempProject(async (root) => {
      const snapshot = await sampleSnapshot(root);
      const frame = renderDashboard(snapshot, { width: 80, color: false, live: false });
      expect(frame).toContain("████████░░ 0.8");
      expect(frame).toContain("░░░░░░░░░░ 0.0");
      expect(frame).toContain("← next");
      expect(frame).toContain("임계 0.7 · 10 축 미해결");
      expect(frame).not.toContain("\x1b[");
      expect(frame).not.toContain("q quit");
    });
  });

  it("adds ANSI colors and the quit hint in live color mode", async () => {
    await withTempProject(async (root) => {
      const snapshot = await sampleSnapshot(root);
      const frame = renderDashboard(snapshot, { width: 80, color: true, live: true });
      expect(frame).toContain("\x1b[32m");
      expect(frame).toContain("q 종료");
    });
  });

  it("switches to English labels for en and mixed profiles", async () => {
    await withTempProject(async (root) => {
      const snapshot = await sampleSnapshot(root);
      const en = renderDashboard({ ...snapshot, profileLanguage: "en" }, { width: 80, color: false, live: true });
      expect(en).toContain("Next:");
      expect(en).toContain("q quit");

      const mixed = renderDashboard(
        { ...snapshot, profileLanguage: "mixed" },
        { width: 80, color: false, live: true }
      );
      expect(mixed).toContain("threshold 0.7 · 10 unresolved");
    });
  });

  it("keeps every line within the requested width", async () => {
    await withTempProject(async (root) => {
      const snapshot = await sampleSnapshot(root);
      const frame = renderDashboard(
        { ...snapshot, profileLanguage: "ko" },
        { width: 44, color: false, live: true }
      );
      for (const line of frame.split("\n")) {
        expect(displayWidth(line)).toBeLessThanOrEqual(44);
      }
    });
  });
});

describe("width helpers", () => {
  it("counts CJK characters as two columns", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("한글")).toBe(4);
    expect(displayWidth("a한b")).toBe(4);
  });

  it("truncates by display width with an ellipsis", () => {
    expect(truncateToWidth("abcdef", 10)).toBe("abcdef");
    expect(truncateToWidth("abcdefghij", 5)).toBe("abcd…");
    const truncated = truncateToWidth("한글이 아주 길게 이어지는 문장", 10);
    expect(displayWidth(truncated)).toBeLessThanOrEqual(10);
    expect(truncated.endsWith("…")).toBe(true);
  });
});
