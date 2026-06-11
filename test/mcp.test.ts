import { describe, expect, it } from "vitest";
import { toolNames } from "../src/mcp/server.js";

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
});
