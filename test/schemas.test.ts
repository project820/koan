import { describe, expect, it } from "vitest";
import { ProjectConfigSchema, UserProfileSchema } from "../src/core/schemas.js";

describe("schemas", () => {
  it("accepts a valid project config", () => {
    const parsed = ProjectConfigSchema.parse({
      version: 1,
      koanVersion: "0.1.0",
      projectRoot: "/tmp/example",
      strictness: "advisory",
      experimentalHandoff: false,
      documents: {
        readme: "koan/README.md",
        goal: "koan/goal.md",
        status: "koan/status.md",
        plan: "koan/plan.md"
      }
    });

    expect(parsed.strictness).toBe("advisory");
  });

  it("rejects a profile with an unknown learning mode", () => {
    expect(() =>
      UserProfileSchema.parse({
        developmentUnderstanding: "beginner",
        explanationStyle: "short",
        language: "ko",
        outputUse: "agent_execution",
        domainBackground: "",
        learningMode: "silent_auto"
      })
    ).toThrow();
  });
});
