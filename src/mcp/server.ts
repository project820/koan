#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { brightIdea, handoff, hello, qa, status } from "../core/commands.js";
import { inspectProject } from "../core/project.js";
import { defaultProfile, loadProfile, saveProfile } from "../core/profile.js";

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
  "koan_prepare_qa",
  "koan_prepare_handoff"
] as const;

const ProjectRootInput = z.object({ projectRoot: z.string() });

function textContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createServer(): Server {
  const server = new Server(
    { name: "koan", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolNames.map((name) => ({
      name,
      description: `Koan tool: ${name}`,
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          homeDir: { type: "string" },
          text: { type: "string" }
        }
      }
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};

    if (request.params.name === "koan_inspect_project") {
      const { projectRoot } = ProjectRootInput.parse(args);
      return textContent(await inspectProject(projectRoot));
    }

    if (request.params.name === "koan_start_session") {
      const parsed = z.object({ projectRoot: z.string(), homeDir: z.string() }).parse(args);
      return textContent(await hello({ cwd: parsed.projectRoot, homeDir: parsed.homeDir }));
    }

    if (request.params.name === "koan_get_status") {
      const { projectRoot } = ProjectRootInput.parse(args);
      return textContent(await status({ cwd: projectRoot }));
    }

    if (request.params.name === "koan_record_bright_idea") {
      const parsed = z.object({ projectRoot: z.string(), text: z.string() }).parse(args);
      await brightIdea({ cwd: parsed.projectRoot, idea: parsed.text });
      return textContent({ recorded: true });
    }

    if (request.params.name === "koan_prepare_qa") {
      const { projectRoot } = ProjectRootInput.parse(args);
      await qa({ cwd: projectRoot });
      return textContent({ prepared: true });
    }

    if (request.params.name === "koan_prepare_handoff") {
      const parsed = z.object({ projectRoot: z.string(), text: z.string() }).parse(args);
      await handoff({ cwd: parsed.projectRoot, summary: parsed.text });
      return textContent({ prepared: true });
    }

    if (request.params.name === "koan_get_profile") {
      const parsed = z.object({ homeDir: z.string() }).parse(args);
      return textContent((await loadProfile(parsed.homeDir)) ?? null);
    }

    if (request.params.name === "koan_update_profile") {
      const parsed = z.object({ homeDir: z.string(), profile: z.unknown() }).parse(args);
      return textContent(await saveProfile(parsed.homeDir, defaultProfile(parsed.profile as Partial<ReturnType<typeof defaultProfile>>)));
    }

    return textContent({
      supported: false,
      tool: request.params.name,
      message: "This MVP tool contract is registered; full semantic flow is host-agent assisted."
    });
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
  runServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
