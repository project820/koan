import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { acceptClarity } from "../src/core/answers.js";
import { loadCommandLog } from "../src/core/commandLog.js";
import { archive } from "../src/core/commands.js";
import { readManagedSection } from "../src/core/documents.js";
import { defaultProfile, loadProfile, saveProfile } from "../src/core/profile.js";
import { AmbiguityAxisSchema } from "../src/core/schemas.js";
import { createServer, toolNames } from "../src/mcp/server.js";

describe("MCP server", () => {
  it("registers verb-based Koan tools", () => {
    expect(toolNames).toEqual([
      "koan_get_profile",
      "koan_update_profile",
      "koan_inspect_project",
      "koan_start_session",
      "koan_get_next_question",
      "koan_record_answer",
      "koan_crystallize_documents",
      "koan_get_status",
      "koan_update_status",
      "koan_record_bright_idea",
      "koan_prepare_qa",
      "koan_prepare_handoff"
    ]);
  });

  it("koan_update_profile preserves existing fields on partial update", async () => {
    const home = await mkdtemp(join(tmpdir(), "koan-mcp-home-"));
    const server = createServer();
    const client = new Client({ name: "koan-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      await saveProfile(
        home,
        defaultProfile({
          developmentUnderstanding: "expert",
          language: "en",
          domainBackground: "finance"
        })
      );

      const result = await client.callTool({
        name: "koan_update_profile",
        arguments: { homeDir: home, profile: { language: "ko" } }
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      const updated = JSON.parse(text);
      expect(updated.language).toBe("ko");
      expect(updated.developmentUnderstanding).toBe("expert");
      expect(updated.domainBackground).toBe("finance");

      const persisted = await loadProfile(home);
      expect(persisted?.language).toBe("ko");
      expect(persisted?.developmentUnderstanding).toBe("expert");
      expect(persisted?.domainBackground).toBe("finance");
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      await rm(home, { recursive: true, force: true });
    }
  });
});

interface McpTestContext {
  client: Client;
  root: string;
  home: string;
}

// Hermetic harness: one temp project dir (with a temp home subdir) plus one
// linked in-memory server/client pair per test, torn down afterwards.
async function withMcp(fn: (ctx: McpTestContext) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "koan-mcp-"));
  const home = join(root, "home");
  const server = createServer();
  const client = new Client({ name: "koan-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await mkdir(home, { recursive: true });
    await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await fn({ client, root, home });
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

// All Koan tool results are JSON in the first text content block. isError
// results are normalized into thrown errors so every failure asserts as a
// rejection regardless of how the server surfaces it.
function toolJson(result: unknown) {
  const typed = result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
  const text = typed.content?.[0]?.text ?? "";
  if (typed.isError) throw new Error(text.length > 0 ? text : "MCP tool error");
  return JSON.parse(text);
}

async function callJson(client: Client, name: string, args: Record<string, unknown>) {
  return toolJson(await client.callTool({ name, arguments: args }));
}

async function expectToolError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  pattern?: RegExp
): Promise<void> {
  const call = callJson(client, name, args);
  await (pattern ? expect(call).rejects.toThrow(pattern) : expect(call).rejects.toThrow());
}

describe("MCP semantic tools", () => {
  it("completes the semantic loop from start_session through crystallize", async () => {
    await withMcp(async ({ client, root, home }) => {
      const rawIntent = "Build a tiny notes CLI that keeps project intent clear.";
      const started = await callJson(client, "koan_start_session", {
        projectRoot: root,
        homeDir: home,
        rawIntent
      });
      expect(typeof started.sessionId).toBe("string");
      expect(started.sessionId.length).toBeGreaterThan(0);
      expect(started.activeGoalId).toBeTruthy();
      expect(started.resumed).toBe(false);
      expect(started.reconstructed).toBe(false);
      expect(started.converged).toBe(false);
      expect(started.ledger.axes).toHaveLength(11);
      expect(typeof started.nextAction).toBe("string");
      expect(started.nextAction.length).toBeGreaterThan(0);
      expect(started.nextQuestion?.axis).toBe("purpose");
      expect(started.rawIntent).toBe(rawIntent);
      expect(started.rawIntentCaptured).toBe(true);
      expect(await readFile(join(root, ".koan/mcp-cache.json"), "utf8")).toContain(rawIntent);

      const reported = await callJson(client, "koan_get_status", { projectRoot: root });
      expect(reported.rawIntent).toBe(rawIntent);

      const question = await callJson(client, "koan_get_next_question", {
        projectRoot: root,
        homeDir: home
      });
      expect(question.converged).toBe(false);
      expect(question.axis).toBe("purpose");
      expect(typeof question.questionId).toBe("string");
      expect(question.questionId.length).toBeGreaterThan(0);
      expect(question.intent).toBeTruthy();
      expect(question.userFacingQuestion).toBeTruthy();
      expect(question.answerSchema).toBe("free_text");
      expect(question.hostAgentInstruction).toBeTruthy();

      const cache = JSON.parse(await readFile(join(root, ".koan/mcp-cache.json"), "utf8"));
      expect(cache.lastQuestion?.axis).toBe("purpose");

      const answerText = "Koan exists to keep agent work aligned with the user's intent.";
      const recorded = await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        answerText
      });
      const purposeEntry = recorded.ledger.axes.find(
        (entry: { axis: string; clarity: number }) => entry.axis === "purpose"
      );
      expect(purposeEntry?.clarity).toBe(0.8);
      expect(recorded.answer.axis).toBe("purpose");
      expect(recorded.answer.answer).toBe(answerText);
      expect(recorded.converged).toBe(false);
      expect(recorded.unresolved).not.toContain("purpose");
      expect(recorded.nextQuestion?.axis).toBe("philosophical_intent");
      expect(typeof recorded.preview.description).toBe("string");
      expect(recorded.preview.files).toContain("koan/goal.md");
      expect(typeof recorded.preview.operations).toBe("number");
      expect(recorded.preview.operations).toBeGreaterThan(0);

      const crystallized = await callJson(client, "koan_crystallize_documents", {
        projectRoot: root,
        homeDir: home
      });
      expect(crystallized.executed).toBe(true);
      expect(crystallized.files).toContain("koan/goal.md");
      expect(crystallized.crystallizedAxes).toContain("purpose");

      const goalText = await readFile(join(root, "koan/goal.md"), "utf8");
      expect(readManagedSection(goalText, "purpose")).toContain(answerText);
    });
  });

  it("koan_record_answer applies interpretation clarity", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      const recorded = await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        axis: "purpose",
        answerText: "A partially clarified purpose.",
        interpretation: { clarity: 0.5 }
      });
      const purposeEntry = recorded.ledger.axes.find(
        (entry: { axis: string; clarity: number }) => entry.axis === "purpose"
      );
      expect(purposeEntry?.clarity).toBe(0.5);
    });
  });

  it("koan_record_answer carries the source into the command-log summary", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        axis: "purpose",
        answerText: "Keep agent work aligned with the user's intent.",
        source: "host-agent"
      });
      const log = await loadCommandLog(root);
      const entry = [...log.entries].reverse().find((candidate) => candidate.command === "koan answer");
      expect(entry?.summary).toBe("Recorded answer for purpose (source: host-agent).");
    });
  });

  it("koan_record_answer rejects without axis, questionId, or cached question", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await rm(join(root, ".koan/mcp-cache.json"), { force: true });
      await expectToolError(
        client,
        "koan_record_answer",
        { projectRoot: root, homeDir: home, answerText: "An answer with no axis context." },
        /No axis given and no cached question context/
      );
    });
  });

  it("koan_record_answer rejects an unknown axis given as questionId", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await expectToolError(
        client,
        "koan_record_answer",
        { projectRoot: root, homeDir: home, questionId: "not_an_axis", answerText: "Anything." },
        /Unknown axis: not_an_axis/
      );
    });
  });

  it("koan_record_answer rejects a cached question from a previous goal's session", async () => {
    await withMcp(async ({ client, root, home }) => {
      const first = await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await callJson(client, "koan_get_next_question", { projectRoot: root, homeDir: home });
      await archive({ cwd: root });

      const second = await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      expect(second.sessionId).not.toBe(first.sessionId);
      const cache = JSON.parse(await readFile(join(root, ".koan/mcp-cache.json"), "utf8"));
      expect(cache.lastQuestion).toBeNull();

      await expectToolError(
        client,
        "koan_record_answer",
        { projectRoot: root, homeDir: home, answerText: "Answer meant for the new goal." },
        /No axis given and no cached question context/
      );

      // Even if a stale entry survives start_session, the session-id guard rejects it.
      const stale = {
        version: 1,
        lastQuestion: {
          sessionId: first.sessionId,
          axis: "purpose",
          questionId: "purpose",
          askedAt: new Date().toISOString()
        },
        rawIntent: null
      };
      await writeFile(join(root, ".koan/mcp-cache.json"), `${JSON.stringify(stale, null, 2)}\n`, "utf8");
      await expectToolError(
        client,
        "koan_record_answer",
        { projectRoot: root, homeDir: home, answerText: "Answer meant for the new goal." },
        /No axis given and no cached question context/
      );
    });
  });

  it("koan_record_answer advances the cached question across no-axis calls", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await callJson(client, "koan_get_next_question", { projectRoot: root, homeDir: home });

      const first = await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        answerText: "First no-axis answer."
      });
      expect(first.answer.axis).toBe("purpose");
      expect(first.nextQuestion?.axis).toBe("philosophical_intent");

      const cache = JSON.parse(await readFile(join(root, ".koan/mcp-cache.json"), "utf8"));
      expect(cache.lastQuestion?.axis).toBe("philosophical_intent");

      const second = await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        answerText: "Second no-axis answer."
      });
      expect(second.answer.axis).toBe("philosophical_intent");
      expect(second.answer.axis).not.toBe(first.answer.axis);
    });
  });

  it("koan_get_next_question reports convergence once every axis is answered", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      let recorded;
      for (const axis of AmbiguityAxisSchema.options) {
        recorded = await callJson(client, "koan_record_answer", {
          projectRoot: root,
          homeDir: home,
          axis,
          answerText: `Answer for ${axis}.`
        });
      }
      expect(recorded?.converged).toBe(true);
      expect(recorded?.nextQuestion).toBeNull();

      const question = await callJson(client, "koan_get_next_question", {
        projectRoot: root,
        homeDir: home
      });
      expect(question).toEqual({ converged: true, question: null });
    });
  });

  it("koan_get_next_question honors the ready phase after koan enough", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      await acceptClarity({ cwd: root });
      const question = await callJson(client, "koan_get_next_question", {
        projectRoot: root,
        homeDir: home
      });
      expect(question).toEqual({ converged: true, question: null });
    });
  });

  it("koan_crystallize_documents dryRun previews without writing", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      const answerText = "Dry-run purpose answer that must not be written.";
      await callJson(client, "koan_record_answer", {
        projectRoot: root,
        homeDir: home,
        axis: "purpose",
        answerText
      });

      const result = await callJson(client, "koan_crystallize_documents", {
        projectRoot: root,
        homeDir: home,
        dryRun: true
      });
      expect(result.executed).toBe(false);
      expect(result.files).toContain("koan/goal.md");
      expect(result.crystallizedAxes).toContain("purpose");
      expect(result.plan.operations.length).toBeGreaterThan(0);

      expect(await readFile(join(root, "koan/goal.md"), "utf8")).not.toContain(answerText);
      await expect(readFile(join(root, "koan/decisions.md"), "utf8")).rejects.toThrow();
    });
  });

  it("koan_get_next_question rejects when no session exists", async () => {
    await withMcp(async ({ client, root, home }) => {
      await expectToolError(client, "koan_get_next_question", {
        projectRoot: root,
        homeDir: home
      });
    });
  });

  it("koan_update_status writes status.md and koan_get_status reports it", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      const statusText = "Stage 5 MCP wiring is underway.";
      const updated = await callJson(client, "koan_update_status", {
        projectRoot: root,
        statusText,
        source: "test"
      });
      expect(updated.updated).toBe(true);
      expect(typeof updated.projectRoot).toBe("string");
      expect(updated.files).toEqual(["koan/status.md", "koan/handoff.md"]);

      const statusDoc = await readFile(join(root, "koan/status.md"), "utf8");
      expect(readManagedSection(statusDoc, "current-status")).toContain(statusText);

      const log = await loadCommandLog(root);
      const entry = [...log.entries].reverse().find((candidate) => candidate.command === "koan status");
      expect(entry?.summary).toBe("Recorded a status update (source: test).");

      const reported = await callJson(client, "koan_get_status", { projectRoot: root });
      expect(reported.didWrite).toBe(false);
      expect(Array.isArray(reported.staleWarnings)).toBe(true);
      expect(reported.summary).toContain("Next action:");
      expect(reported.summary).toContain(statusText);
      expect(reported.rawIntent).toBeNull();
    });
  });

  it("koan_record_bright_idea returns deterministic recommendations", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      const rejected = await callJson(client, "koan_record_bright_idea", {
        projectRoot: root,
        text: "Rewrite the whole tool in a new framework.",
        classification: "reject"
      });
      expect(rejected.recorded).toBe(true);
      expect(rejected.classification).toBe("reject");
      expect(rejected.recommendation).toBe("Recorded for reference; no action planned.");

      const defaulted = await callJson(client, "koan_record_bright_idea", {
        projectRoot: root,
        text: "Add a web dashboard for ledgers."
      });
      expect(defaulted.recorded).toBe(true);
      expect(defaulted.classification).toBe("later-follow-up");

      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Rewrite the whole tool in a new framework.");
      expect(ideas).toContain("Add a web dashboard for ledgers.");
    });
  });

  it("koan_inspect_project reports documents and default git policy", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });
      const inspected = await callJson(client, "koan_inspect_project", { projectRoot: root });
      expect(typeof inspected.projectRoot).toBe("string");
      expect(inspected.isKoanProject).toBe(true);
      expect(inspected.hasAgentsMd).toBe(true);
      expect(inspected.hasClaudeMd).toBe(true);
      expect(inspected.hasKoanBootstrap).toBe(true);
      expect(inspected.documents).toEqual({
        readme: "koan/README.md",
        goal: "koan/goal.md",
        status: "koan/status.md",
        plan: "koan/plan.md"
      });
      expect(inspected.gitPolicy).toEqual({ path: ".koan/.gitignore", matchesDefault: true });
    });
  });

  it("koan_prepare_qa and koan_prepare_handoff create their documents", async () => {
    await withMcp(async ({ client, root, home }) => {
      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });

      const implementationSummary = "Implemented the Stage 5 MCP tool surface.";
      const qaResult = await callJson(client, "koan_prepare_qa", {
        projectRoot: root,
        implementationSummary
      });
      expect(qaResult.prepared).toBe(true);
      expect(qaResult.path).toBe("koan/qa.md");
      expect(qaResult.checklist).toContain("# QA");
      expect(qaResult.checklist).toContain("## Implementation Summary (host-provided)");
      expect(qaResult.checklist).toContain(implementationSummary);
      const qaDoc = await readFile(join(root, "koan/qa.md"), "utf8");
      expect(qaDoc).toContain("# QA");
      expect(qaDoc).toContain("## Implementation Summary (host-provided)");
      expect(qaDoc).toContain(implementationSummary);

      const handoffText = "Continue with Stage 5 README polish.";
      const handoffResult = await callJson(client, "koan_prepare_handoff", {
        projectRoot: root,
        text: handoffText
      });
      expect(handoffResult.prepared).toBe(true);
      expect(handoffResult.path).toBe("koan/handoff.md");
      expect(handoffResult.handoff).toContain(handoffText);
      expect(typeof handoffResult.nextAction).toBe("string");
      expect(handoffResult.nextAction.length).toBeGreaterThan(0);
      expect(handoffResult.experimental).toEqual({ enabled: false, adapter: null });
      expect(await readFile(join(root, "koan/handoff.md"), "utf8")).toContain(handoffText);

      const defaulted = await callJson(client, "koan_prepare_handoff", { projectRoot: root });
      expect(defaulted.prepared).toBe(true);
      expect(defaulted.handoff).toContain("Handoff prepared via MCP.");
      expect(await readFile(join(root, "koan/handoff.md"), "utf8")).toContain("Handoff prepared via MCP.");
    });
  });

  it("koan_get_profile exposes overrides only with a project root", async () => {
    await withMcp(async ({ client, root, home }) => {
      await saveProfile(home, defaultProfile({ language: "en" }));

      const globalOnly = await callJson(client, "koan_get_profile", { homeDir: home });
      expect(globalOnly.profile?.language).toBe("en");
      expect(globalOnly.learningMode).toBe("approval_required");
      expect(globalOnly.overrides).toBeNull();

      await callJson(client, "koan_start_session", { projectRoot: root, homeDir: home });

      const scoped = await callJson(client, "koan_get_profile", {
        homeDir: home,
        projectRoot: root
      });
      expect(scoped.profile?.language).toBe("en");
      expect(scoped.overrides).toEqual({});
    });
  });

  it("koan_update_profile reports changed fields", async () => {
    await withMcp(async ({ client, home }) => {
      await saveProfile(home, defaultProfile({ language: "en" }));
      const result = await callJson(client, "koan_update_profile", {
        homeDir: home,
        profile: { language: "ko", domainBackground: "fintech" }
      });
      expect(result.language).toBe("ko");
      expect(result.domainBackground).toBe("fintech");
      expect(Array.isArray(result.changedFields)).toBe(true);
      expect([...result.changedFields].sort()).toEqual(["domainBackground", "language"]);
    });
  });

  it("listTools declares per-tool input schemas with required arrays", async () => {
    await withMcp(async ({ client }) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...toolNames].sort());
      for (const tool of listed.tools) {
        const schema = tool.inputSchema as { type?: string; required?: unknown };
        expect(schema.type, `${tool.name} inputSchema.type`).toBe("object");
        expect(Array.isArray(schema.required), `${tool.name} inputSchema.required`).toBe(true);
        expect((schema.required as string[]).length, `${tool.name} required fields`).toBeGreaterThan(0);
      }
    });
  });
});
