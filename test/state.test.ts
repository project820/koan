import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendCommandLog, loadCommandLog } from "../src/core/commandLog.js";
import { KOAN_STATE_DIR, STATE_FILES } from "../src/core/constants.js";
import { defaultKoanGitignore } from "../src/core/gitPolicy.js";
import { loadMcpCache, saveMcpCache } from "../src/core/mcpCache.js";
import { getProfilePath } from "../src/core/profile.js";
import { ensureProfileRef, loadProfileRef } from "../src/core/profileRef.js";
import { type CommandLog, type McpCache } from "../src/core/schemas.js";
import { withTempProject } from "./helpers/fs.js";

describe("command log", () => {
  it("appends entries in order", async () => {
    await withTempProject(async (root) => {
      await appendCommandLog(root, { command: "koan hello", summary: "Initialized." }, "2026-06-01T00:00:00.000Z");
      const appended = await appendCommandLog(root, { command: "koan qa", summary: "Checked." }, "2026-06-02T00:00:00.000Z");
      expect(appended.entries).toEqual([
        { at: "2026-06-01T00:00:00.000Z", command: "koan hello", summary: "Initialized." },
        { at: "2026-06-02T00:00:00.000Z", command: "koan qa", summary: "Checked." }
      ]);
      expect(await loadCommandLog(root)).toEqual(appended);
    });
  });

  it("caps entries at the most recent 500", async () => {
    await withTempProject(async (root) => {
      const seeded: CommandLog = {
        version: 1,
        entries: Array.from({ length: 500 }, (_, index) => ({
          at: "2026-06-01T00:00:00.000Z",
          command: `koan seed-${index}`,
          summary: `Seed entry ${index}`
        }))
      };
      await mkdir(join(root, KOAN_STATE_DIR), { recursive: true });
      await writeFile(join(root, STATE_FILES.commandLog), `${JSON.stringify(seeded)}\n`, "utf8");

      await appendCommandLog(root, { command: "koan qa", summary: "First overflow." }, "2026-06-02T00:00:00.000Z");
      await appendCommandLog(root, { command: "koan handoff", summary: "Second overflow." }, "2026-06-03T00:00:00.000Z");

      const log = await loadCommandLog(root);
      expect(log.entries).toHaveLength(500);
      expect(log.entries[0]?.command).toBe("koan seed-2");
      expect(log.entries.at(-2)?.command).toBe("koan qa");
      expect(log.entries.at(-1)?.command).toBe("koan handoff");
    });
  });

  it("recovers a fresh log from corrupt JSON", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, KOAN_STATE_DIR), { recursive: true });
      await writeFile(join(root, STATE_FILES.commandLog), "{not json", "utf8");
      expect(await loadCommandLog(root)).toEqual({ version: 1, entries: [] });

      const log = await appendCommandLog(root, { command: "koan hello", summary: "Recovered." }, "2026-06-01T00:00:00.000Z");
      expect(log.entries).toEqual([
        { at: "2026-06-01T00:00:00.000Z", command: "koan hello", summary: "Recovered." }
      ]);
      expect(await readFile(join(root, `${STATE_FILES.commandLog}.bak`), "utf8")).toBe("{not json");
    });
  });

  it("creates the state gitignore alongside the command log", async () => {
    await withTempProject(async (root) => {
      await appendCommandLog(root, { command: "koan handoff", summary: "First write." }, "2026-06-01T00:00:00.000Z");
      expect(await readFile(join(root, STATE_FILES.gitignore), "utf8")).toBe(defaultKoanGitignore());
    });
  });
});

describe("profile ref", () => {
  it("creates the ref pointing at the shared profile path", async () => {
    await withTempProject(async (root) => {
      const ref = await ensureProfileRef(root, root);
      expect(ref).toEqual({ version: 1, profilePath: getProfilePath(root), overrides: {} });
      expect(await loadProfileRef(root)).toEqual(ref);
    });
  });

  it("keeps existing overrides on rerun", async () => {
    await withTempProject(async (root) => {
      await ensureProfileRef(root, root);
      const path = join(root, STATE_FILES.userProfileRef);
      const stored = JSON.parse(await readFile(path, "utf8"));
      stored.overrides = { language: "en" };
      await writeFile(path, `${JSON.stringify(stored)}\n`, "utf8");

      const ref = await ensureProfileRef(root, join(root, "other-home"));
      expect(ref.profilePath).toBe(getProfilePath(root));
      expect(ref.overrides).toEqual({ language: "en" });
      expect(await loadProfileRef(root)).toEqual(ref);
    });
  });

  it("rewrites an unparseable ref and preserves a backup", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, KOAN_STATE_DIR), { recursive: true });
      await writeFile(join(root, STATE_FILES.userProfileRef), "{not json", "utf8");

      const ref = await ensureProfileRef(root, root);
      expect(ref).toEqual({ version: 1, profilePath: getProfilePath(root), overrides: {} });
      expect(await loadProfileRef(root)).toEqual(ref);
      expect(await readFile(join(root, `${STATE_FILES.userProfileRef}.bak`), "utf8")).toBe("{not json");
    });
  });
});

describe("mcp cache", () => {
  it("roundtrips the last question", async () => {
    await withTempProject(async (root) => {
      const cache: McpCache = {
        version: 1,
        lastQuestion: {
          sessionId: "session-1",
          axis: "purpose",
          questionId: "purpose-1",
          askedAt: "2026-06-01T00:00:00.000Z"
        },
        rawIntent: null
      };
      await saveMcpCache(root, cache);
      expect(await loadMcpCache(root)).toEqual(cache);
    });
  });

  it("recovers an empty cache when missing or corrupt", async () => {
    await withTempProject(async (root) => {
      expect(await loadMcpCache(root)).toEqual({ version: 1, lastQuestion: null, rawIntent: null });

      await mkdir(join(root, KOAN_STATE_DIR), { recursive: true });
      await writeFile(join(root, STATE_FILES.mcpCache), "{not json", "utf8");
      expect(await loadMcpCache(root)).toEqual({ version: 1, lastQuestion: null, rawIntent: null });
    });
  });
});
