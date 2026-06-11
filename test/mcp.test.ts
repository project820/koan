import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defaultProfile, loadProfile, saveProfile } from "../src/core/profile.js";
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
