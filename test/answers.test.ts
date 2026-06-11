import { describe, expect, it } from "vitest";
import { recordAnswer, type RecordAnswerResult } from "../src/core/answers.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { hello } from "../src/core/commands.js";
import { AmbiguityAxisSchema, type AmbiguityAxis, type AmbiguityLedger } from "../src/core/schemas.js";
import { loadLedger } from "../src/core/scoring.js";
import { loadSessionState } from "../src/core/session.js";
import { withTempProject } from "./helpers/fs.js";

function axisClarity(ledger: AmbiguityLedger | null, axis: AmbiguityAxis): number | undefined {
  return ledger?.axes.find((entry) => entry.axis === axis)?.clarity;
}

describe("recordAnswer", () => {
  it("throws when no session exists", async () => {
    await withTempProject(async (root) => {
      await expect(
        recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "Keep agents aligned." })
      ).rejects.toThrow("No active Koan session. Run koan hello first.");
    });
  });

  it("records an answer, scores the axis, and logs the command", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await recordAnswer({
        cwd: root,
        homeDir: root,
        axis: "purpose",
        answer: "Keep coding agents aligned with the project's original intent."
      });

      expect(result.answer.questionId).toBe("purpose");
      expect(result.answer.axis).toBe("purpose");
      expect(axisClarity(result.ledger, "purpose")).toBe(0.8);
      expect(result.converged).toBe(false);
      expect(result.nextQuestion).not.toBeNull();
      expect(axisClarity(await loadLedger(root), "purpose")).toBe(0.8);

      const state = await loadSessionState(root);
      expect(state?.answers).toHaveLength(1);
      expect(state?.answers[0]?.questionId).toBe("purpose");
      expect(state?.lastQuestionId).toBe("purpose");

      const log = await loadCommandLog(root);
      expect(log.entries.at(-1)?.command).toBe("koan answer");
    });
  });

  it("respects an explicit clarity override", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await recordAnswer({
        cwd: root,
        homeDir: root,
        axis: "scope",
        answer: "Probably the CLI, maybe MCP too.",
        clarity: 0.4
      });
      expect(axisClarity(result.ledger, "scope")).toBe(0.4);
      expect(axisClarity(await loadLedger(root), "scope")).toBe(0.4);
    });
  });

  it("scores an empty answer as zero clarity", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      const result = await recordAnswer({ cwd: root, homeDir: root, axis: "purpose", answer: "   " });
      expect(axisClarity(result.ledger, "purpose")).toBe(0);
      expect(result.converged).toBe(false);
    });
  });

  it("converges once every axis is answered clearly", async () => {
    await withTempProject(async (root) => {
      await hello({ cwd: root, homeDir: root });
      let last: RecordAnswerResult | null = null;
      for (const axis of AmbiguityAxisSchema.options) {
        last = await recordAnswer({
          cwd: root,
          homeDir: root,
          axis,
          answer: `Decided: ${axis} is settled.`,
          clarity: 1
        });
      }
      expect(last?.converged).toBe(true);
      expect(last?.nextQuestion).toBeNull();
      expect(last?.unresolved).toHaveLength(0);

      const state = await loadSessionState(root);
      expect(state?.phase).toBe("ready");
      expect(state?.answers).toHaveLength(AmbiguityAxisSchema.options.length);
    });
  });
});
