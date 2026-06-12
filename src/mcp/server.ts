#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { recordAnswer } from "../core/answers.js";
import { brightIdea, handoff, hello, qa, recordInsight, status, updateStatus } from "../core/commands.js";
import { CORE_DOCUMENTS, KOAN_VERSION, LAZY_DOCUMENTS, STATE_FILES } from "../core/constants.js";
import { crystallize } from "../core/crystallize.js";
import { collectDashboardSnapshot } from "../core/dashboard.js";
import { defaultKoanGitignore } from "../core/gitPolicy.js";
import { adapterFor, detectHost, type HostId } from "../core/hostAdapter.js";
import { buildPrd } from "../core/prd.js";
import { loadMcpCache, updateMcpCache } from "../core/mcpCache.js";
import { defaultProfile, loadProfile, updateProfile } from "../core/profile.js";
import { loadProfileRef } from "../core/profileRef.js";
import { inspectProject, loadProjectConfig } from "../core/project.js";
import { getQuestion } from "../core/questions.js";
import {
  AmbiguityAxisSchema,
  DEFAULT_CONVERGENCE_THRESHOLD,
  DevelopmentUnderstandingSchema,
  ExplanationStyleSchema,
  LanguageSchema,
  LearningModeSchema,
  OutputUseSchema,
  UserProfileSchema,
  type UserProfile
} from "../core/schemas.js";
import { createInitialLedger, isConverged, loadLedger, selectMostUnclearAxis } from "../core/scoring.js";
import { loadSessionState } from "../core/session.js";

export const toolNames = [
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
  "koan_record_insight",
  "koan_synthesize_prd",
  "koan_prepare_qa",
  "koan_prepare_handoff",
  "koan_get_dashboard"
] as const;

type ToolName = (typeof toolNames)[number];

const BrightIdeaClassificationSchema = z.enum(["clarify", "change-goal", "later-follow-up", "reject"]);

const profileFieldProperties = {
  developmentUnderstanding: { type: "string", enum: [...DevelopmentUnderstandingSchema.options] },
  explanationStyle: { type: "string", enum: [...ExplanationStyleSchema.options] },
  language: { type: "string", enum: [...LanguageSchema.options] },
  outputUse: { type: "string", enum: [...OutputUseSchema.options] },
  domainBackground: { type: "string" },
  learningMode: { type: "string", enum: [...LearningModeSchema.options] }
};

interface ToolContext {
  host: HostId;
}

interface ToolDefinition {
  description: string;
  inputSchema: Tool["inputSchema"];
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

// The host adapter only varies instruction phrasing; reapplying it to a
// question computed by host-agnostic core code keeps the core API unchanged.
function withHostInstruction<T extends { hostAgentInstruction: string } | null>(
  question: T,
  host: HostId
): T {
  if (!question) return question;
  return { ...question, hostAgentInstruction: adapterFor(host).questionInstruction };
}

function textContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const tools: Record<ToolName, ToolDefinition> = {
  koan_get_profile: {
    description: "Load the global Koan user profile (defaults when unset), its learning mode, and project overrides.",
    inputSchema: {
      type: "object",
      properties: { homeDir: { type: "string" }, projectRoot: { type: "string" } },
      required: ["homeDir"]
    },
    handler: async (args) => {
      const parsed = z.object({ homeDir: z.string(), projectRoot: z.string().optional() }).parse(args);
      const profile = (await loadProfile(parsed.homeDir)) ?? defaultProfile();
      const overrides = parsed.projectRoot
        ? ((await loadProfileRef(parsed.projectRoot))?.overrides ?? null)
        : null;
      return { profile, learningMode: profile.learningMode, overrides };
    }
  },
  koan_update_profile: {
    description: "Apply approved partial changes to the global user profile and report which fields changed.",
    inputSchema: {
      type: "object",
      properties: {
        homeDir: { type: "string" },
        profile: { type: "object", properties: profileFieldProperties }
      },
      required: ["homeDir", "profile"]
    },
    handler: async (args) => {
      const parsed = z.object({ homeDir: z.string(), profile: UserProfileSchema.partial() }).parse(args);
      const before = (await loadProfile(parsed.homeDir)) ?? defaultProfile();
      const updated = await updateProfile(parsed.homeDir, parsed.profile);
      const changedFields = (Object.keys(updated) as Array<keyof UserProfile>).filter(
        (field) => before[field] !== updated[field]
      );
      return { ...updated, changedFields };
    }
  },
  koan_inspect_project: {
    description: "Inspect a directory for Koan project state, bootstrap markers, document paths, and git policy.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" } },
      required: ["projectRoot"]
    },
    handler: async (args) => {
      const parsed = z.object({ projectRoot: z.string() }).parse(args);
      const inspection = await inspectProject(parsed.projectRoot);
      const gitignore = await readFile(join(inspection.projectRoot, STATE_FILES.gitignore), "utf8").catch(
        () => null
      );
      return {
        ...inspection,
        documents: CORE_DOCUMENTS,
        gitPolicy: { path: STATE_FILES.gitignore, matchesDefault: gitignore === defaultKoanGitignore() }
      };
    }
  },
  koan_start_session: {
    description:
      "Initialize or resume a Koan session and return its session id, ledger, next action, and next question. The resume input is informational: hello always resumes an existing session.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        homeDir: { type: "string" },
        rawIntent: { type: "string" },
        resume: { type: "boolean" }
      },
      required: ["projectRoot", "homeDir"]
    },
    handler: async (args, context) => {
      const parsed = z
        .object({
          projectRoot: z.string(),
          homeDir: z.string(),
          rawIntent: z.string().optional(),
          resume: z.boolean().optional()
        })
        .parse(args);
      const result = await hello({ cwd: parsed.projectRoot, homeDir: parsed.homeDir });
      const state = await loadSessionState(result.projectRoot);
      const { nextAction } = await status({ cwd: result.projectRoot });
      const ledger = await loadLedger(result.projectRoot);
      const sessionId = state?.sessionId ?? null;
      const rawIntent = parsed.rawIntent ?? "";
      const rawIntentCaptured = rawIntent.length > 0;
      // Drop any cached question that belongs to a different session so a
      // later no-axis record_answer cannot target a stale goal's axis.
      const cache = await updateMcpCache(result.projectRoot, (current) => ({
        ...current,
        rawIntent: rawIntentCaptured ? rawIntent : current.rawIntent,
        lastQuestion: current.lastQuestion?.sessionId === sessionId ? current.lastQuestion : null
      }));
      return {
        sessionId,
        activeGoalId: result.activeGoalId,
        nextAction,
        ledger,
        resumed: result.resumed,
        reconstructed: result.reconstructed,
        converged: result.converged,
        nextQuestion: withHostInstruction(result.nextQuestion, context.host),
        resumeRequested: parsed.resume ?? false,
        rawIntent: cache.rawIntent,
        rawIntentCaptured
      };
    }
  },
  koan_get_next_question: {
    description: "Select the most unclear ambiguity axis and return its profile-adapted question for the host agent.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" }, homeDir: { type: "string" } },
      required: ["projectRoot", "homeDir"]
    },
    handler: async (args, context) => {
      const parsed = z.object({ projectRoot: z.string(), homeDir: z.string() }).parse(args);
      const state = await loadSessionState(parsed.projectRoot);
      if (!state) throw new Error("No active Koan session. Run koan hello first.");
      if (!state.activeGoalId || state.phase === "archived") {
        throw new Error("No active goal. Run koan hello first.");
      }
      const profile = (await loadProfile(parsed.homeDir)) ?? defaultProfile();
      const stored = await loadLedger(parsed.projectRoot);
      const ledger =
        stored && stored.goalId === state.activeGoalId ? stored : createInitialLedger(state.activeGoalId);
      const threshold =
        (await loadProjectConfig(parsed.projectRoot))?.settings.convergenceThreshold ??
        DEFAULT_CONVERGENCE_THRESHOLD;
      if (state.phase === "ready" || isConverged(ledger, threshold)) {
        return { converged: true, question: null };
      }
      const axis = selectMostUnclearAxis(ledger);
      const question = getQuestion(axis, profile, context.host);
      await updateMcpCache(parsed.projectRoot, (current) => ({
        ...current,
        lastQuestion: { sessionId: state.sessionId, axis, questionId: axis, askedAt: new Date().toISOString() }
      }));
      return {
        converged: false,
        questionId: axis,
        axis,
        intent: question.intent,
        userFacingQuestion: question.userFacingQuestion,
        answerSchema: question.answerSchema,
        hostAgentInstruction: question.hostAgentInstruction
      };
    }
  },
  koan_record_answer: {
    description: "Record an answer for an ambiguity axis, update the ledger, and preview the crystallize write plan.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        homeDir: { type: "string" },
        answerText: { type: "string" },
        axis: { type: "string", enum: [...AmbiguityAxisSchema.options] },
        questionId: { type: "string" },
        source: { type: "string" },
        interpretation: {
          type: "object",
          properties: { clarity: { type: "number", minimum: 0, maximum: 1 } }
        }
      },
      required: ["projectRoot", "homeDir", "answerText"]
    },
    handler: async (args, context) => {
      const parsed = z
        .object({
          projectRoot: z.string(),
          homeDir: z.string(),
          answerText: z.string(),
          axis: AmbiguityAxisSchema.optional(),
          questionId: z.string().optional(),
          source: z.string().optional(),
          interpretation: z.object({ clarity: z.number().min(0).max(1).optional() }).optional()
        })
        .parse(args);
      const state = await loadSessionState(parsed.projectRoot);
      let candidate: string | undefined = parsed.axis ?? parsed.questionId;
      if (candidate === undefined && state) {
        // Only trust the cached question when it was asked in this session;
        // a cache left over from an earlier goal must not absorb answers.
        const cached = (await loadMcpCache(parsed.projectRoot)).lastQuestion;
        if (cached && cached.sessionId === state.sessionId) candidate = cached.axis;
      }
      if (candidate === undefined) throw new Error("No axis given and no cached question context.");
      const resolvedAxis = AmbiguityAxisSchema.safeParse(candidate);
      if (!resolvedAxis.success) throw new Error(`Unknown axis: ${candidate}`);
      const result = await recordAnswer({
        cwd: parsed.projectRoot,
        homeDir: parsed.homeDir,
        axis: resolvedAxis.data,
        answer: parsed.answerText,
        clarity: parsed.interpretation?.clarity,
        source: parsed.source
      });
      if (state) {
        // Advance the cached question so consecutive no-axis answers walk the
        // axes instead of re-answering the axis from get_next_question.
        const sessionId = state.sessionId;
        await updateMcpCache(parsed.projectRoot, (current) => ({
          ...current,
          lastQuestion: result.nextQuestion
            ? {
                sessionId,
                axis: result.nextQuestion.axis,
                questionId: result.nextQuestion.axis,
                askedAt: new Date().toISOString()
              }
            : null
        }));
      }
      const preview = await crystallize({ cwd: parsed.projectRoot, homeDir: parsed.homeDir, dryRun: true });
      return {
        ledger: result.ledger,
        answer: result.answer,
        converged: result.converged,
        unresolved: result.unresolved,
        nextQuestion: withHostInstruction(result.nextQuestion, context.host),
        preview: {
          description: preview.plan.description,
          files: preview.files,
          operations: preview.plan.operations.length
        }
      };
    }
  },
  koan_crystallize_documents: {
    description: "Crystallize recorded answers into koan/*.md managed regions; dryRun returns the write plan only.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        homeDir: { type: "string" },
        dryRun: { type: "boolean" }
      },
      required: ["projectRoot", "homeDir"]
    },
    handler: async (args) => {
      const parsed = z
        .object({ projectRoot: z.string(), homeDir: z.string(), dryRun: z.boolean().optional() })
        .parse(args);
      const result = await crystallize({ cwd: parsed.projectRoot, homeDir: parsed.homeDir, dryRun: parsed.dryRun });
      return {
        plan: result.plan,
        executed: result.executed,
        files: result.files,
        crystallizedAxes: result.crystallizedAxes
      };
    }
  },
  koan_get_status: {
    description:
      "Read the status summary with stale-state warnings, the next recommended action, and the captured raw intent.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" } },
      required: ["projectRoot"]
    },
    handler: async (args) => {
      const parsed = z.object({ projectRoot: z.string() }).parse(args);
      const result = await status({ cwd: parsed.projectRoot });
      const cache = await loadMcpCache(parsed.projectRoot);
      return { ...result, rawIntent: cache.rawIntent };
    }
  },
  koan_update_status: {
    description: "Write a status update into the status.md managed region and mirror it into handoff.md.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        statusText: { type: "string" },
        source: { type: "string" }
      },
      required: ["projectRoot", "statusText"]
    },
    handler: async (args) => {
      const parsed = z
        .object({ projectRoot: z.string(), statusText: z.string(), source: z.string().optional() })
        .parse(args);
      const result = await updateStatus({
        cwd: parsed.projectRoot,
        update: parsed.statusText,
        source: parsed.source
      });
      return {
        updated: true,
        projectRoot: result.projectRoot,
        files: [CORE_DOCUMENTS.status, LAZY_DOCUMENTS.handoff]
      };
    }
  },
  koan_record_bright_idea: {
    description: "Append a mid-implementation idea to bright-ideas.md and return the classification recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        text: { type: "string" },
        classification: { type: "string", enum: [...BrightIdeaClassificationSchema.options] }
      },
      required: ["projectRoot", "text"]
    },
    handler: async (args) => {
      const parsed = z
        .object({
          projectRoot: z.string(),
          text: z.string(),
          classification: BrightIdeaClassificationSchema.optional()
        })
        .parse(args);
      const result = await brightIdea({
        cwd: parsed.projectRoot,
        idea: parsed.text,
        classification: parsed.classification
      });
      return { recorded: true, classification: result.classification, recommendation: result.recommendation };
    }
  },
  koan_record_insight: {
    description:
      "Append a product realization — the user discovering that the real product differs from the surface request — to koan/philosophy.md. Append-only: insights chronicle how the product's why sharpened over time.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        text: { type: "string" }
      },
      required: ["projectRoot", "text"]
    },
    handler: async (args) => {
      const parsed = z.object({ projectRoot: z.string(), text: z.string() }).parse(args);
      const result = await recordInsight({ cwd: parsed.projectRoot, text: parsed.text });
      return { recorded: true, path: result.path };
    }
  },
  koan_synthesize_prd: {
    description:
      "Synthesize koan/prd.md: deterministic sections are assembled from recorded answers; the host may provide vision, coreValue, problemAntiProblem, and userStories synthesized strictly from the recorded answers and koan/philosophy.md — never invented requirements.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        homeDir: { type: "string" },
        sections: {
          type: "object",
          properties: {
            vision: { type: "string" },
            coreValue: { type: "string" },
            problemAntiProblem: { type: "string" },
            userStories: { type: "string" }
          }
        },
        dryRun: { type: "boolean" }
      },
      required: ["projectRoot", "homeDir"]
    },
    handler: async (args, context) => {
      const parsed = z
        .object({
          projectRoot: z.string(),
          homeDir: z.string(),
          sections: z
            .object({
              vision: z.string().optional(),
              coreValue: z.string().optional(),
              problemAntiProblem: z.string().optional(),
              userStories: z.string().optional()
            })
            .optional(),
          dryRun: z.boolean().optional()
        })
        .parse(args);
      const result = await buildPrd({
        cwd: parsed.projectRoot,
        homeDir: parsed.homeDir,
        sections: parsed.sections,
        host: context.host,
        dryRun: parsed.dryRun
      });
      return {
        prepared: result.executed,
        path: result.path,
        operations: result.plan.operations.length,
        document: result.document
      };
    }
  },
  koan_prepare_qa: {
    description:
      "Generate the QA checklist at koan/qa.md from the goal and plan documents, embedding an optional host-provided implementation summary.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        implementationSummary: { type: "string" }
      },
      required: ["projectRoot"]
    },
    handler: async (args, context) => {
      const parsed = z
        .object({ projectRoot: z.string(), implementationSummary: z.string().optional() })
        .parse(args);
      const result = await qa({
        cwd: parsed.projectRoot,
        implementationSummary: parsed.implementationSummary,
        host: context.host
      });
      return { prepared: true, path: LAZY_DOCUMENTS.qa, checklist: result.checklist };
    }
  },
  koan_get_dashboard: {
    description:
      "Read-only snapshot of session phase, per-axis clarity in question-priority order, next question, document summaries, insights, and warnings. Never writes project state.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" }, homeDir: { type: "string" } },
      required: ["projectRoot", "homeDir"]
    },
    handler: async (args, context) => {
      const parsed = z.object({ projectRoot: z.string(), homeDir: z.string() }).parse(args);
      return collectDashboardSnapshot({
        cwd: parsed.projectRoot,
        homeDir: parsed.homeDir,
        host: context.host
      });
    }
  },
  koan_prepare_handoff: {
    description:
      "Write the document-based handoff at koan/handoff.md from the optional session summary and return the document with the next action.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" }, text: { type: "string" } },
      required: ["projectRoot"]
    },
    handler: async (args) => {
      const parsed = z.object({ projectRoot: z.string(), text: z.string().optional() }).parse(args);
      const result = await handoff({
        cwd: parsed.projectRoot,
        summary: parsed.text ?? "Handoff prepared via MCP."
      });
      const { nextAction } = await status({ cwd: parsed.projectRoot });
      return {
        prepared: true,
        path: LAZY_DOCUMENTS.handoff,
        handoff: result.document,
        nextAction,
        experimental: { enabled: false, adapter: null }
      };
    }
  }
};

function isToolName(name: string): name is ToolName {
  return (toolNames as readonly string[]).includes(name);
}

export function createServer(): Server {
  const server = new Server(
    { name: "koan", version: KOAN_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolNames.map((name) => ({
      name,
      description: tools[name].description,
      inputSchema: tools[name].inputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    if (!isToolName(name)) throw new Error(`Unknown tool: ${name}`);
    // clientInfo comes from the MCP initialize handshake — a local, deterministic
    // signal; unknown or absent clients fall back to the generic adapter.
    const context: ToolContext = { host: detectHost(server.getClientVersion()?.name) };
    return textContent(await tools[name].handler(request.params.arguments ?? {}, context));
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// npm bin shims invoke this module through a symlink named koan-mcp, so the
// entry path is realpath-resolved before comparing against this module's file;
// the suffix checks remain as a fallback for environments without realpath.
function isDirectInvocation(entry: string | undefined): boolean {
  if (!entry) return false;
  try {
    if (realpathSync(entry) === fileURLToPath(import.meta.url)) return true;
  } catch {
    // fall through to the suffix checks
  }
  return entry.endsWith("server.js") || entry.endsWith("server.ts");
}

if (isDirectInvocation(process.argv[1])) {
  runServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
