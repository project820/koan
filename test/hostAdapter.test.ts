import { describe, expect, it } from "vitest";
import { adapterFor, detectHost, type HostId } from "../src/core/hostAdapter.js";
import { defaultProfile } from "../src/core/profile.js";
import { buildQaChecklist } from "../src/core/qa.js";
import { getQuestion } from "../src/core/questions.js";

const HOSTS: HostId[] = ["generic", "claude", "codex"];

describe("detectHost", () => {
  it("maps client names to host ids", () => {
    expect(detectHost("claude-code")).toBe("claude");
    expect(detectHost("Claude Desktop")).toBe("claude");
    expect(detectHost("codex-cli")).toBe("codex");
    expect(detectHost("openai-agents")).toBe("codex");
    expect(detectHost("gpt-5-host")).toBe("codex");
    expect(detectHost("gemini-cli")).toBe("generic");
    expect(detectHost(undefined)).toBe("generic");
    expect(detectHost("")).toBe("generic");
  });
});

describe("adapter semantic parity", () => {
  // Variants may differ in style, never in contract: every host must receive
  // the same obligations, or cross-agent symmetry breaks.
  it("every questionInstruction carries the full recording contract", () => {
    for (const host of HOSTS) {
      const instruction = adapterFor(host).questionInstruction;
      expect(instruction).toContain("reasoning");
      expect(instruction).toContain("decision");
      expect(instruction).toContain("constraints");
      expect(instruction).toContain("out-of-scope");
      expect(instruction).toContain("koan_record_insight");
    }
  });

  it("every qaPrompt separates spec, philosophy, and quality review", () => {
    for (const host of HOSTS) {
      const prompt = adapterFor(host).qaPrompt;
      expect(prompt).toContain("koan/philosophy.md");
      expect(prompt).toContain("compliance");
      expect(prompt).toContain("philosophy-alignment");
      expect(prompt).toContain("quality");
    }
  });

  it("every prdSynthesisInstruction forbids invented requirements", () => {
    for (const host of HOSTS) {
      const instruction = adapterFor(host).prdSynthesisInstruction;
      expect(instruction).toContain("koan/philosophy.md");
      expect(instruction).toContain("not invent requirements");
      expect(instruction).toContain("koan_synthesize_prd");
    }
  });
});

describe("host wiring", () => {
  it("getQuestion returns the host-specific instruction and defaults to generic", () => {
    const profile = defaultProfile({ language: "en" });
    expect(getQuestion("purpose", profile).hostAgentInstruction).toBe(adapterFor("generic").questionInstruction);
    expect(getQuestion("purpose", profile, "claude").hostAgentInstruction).toBe(
      adapterFor("claude").questionInstruction
    );
    expect(getQuestion("purpose", profile, "claude").userFacingQuestion).toBe(
      getQuestion("purpose", profile, "codex").userFacingQuestion
    );
  });

  it("buildQaChecklist embeds the host-specific prompt and defaults to generic", () => {
    expect(buildQaChecklist()).toContain(adapterFor("generic").qaPrompt);
    expect(buildQaChecklist(undefined, "codex")).toContain(adapterFor("codex").qaPrompt);
  });
});
