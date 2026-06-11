import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KOAN_VERSION } from "../src/core/constants.js";
import { defaultKoanGitignore } from "../src/core/gitPolicy.js";
import { KoanLockError } from "../src/core/lock.js";
import { ensureKoanProject, inspectProject, loadProjectConfig } from "../src/core/project.js";
import { readText, withTempProject } from "./helpers/fs.js";

describe("project initialization", () => {
  it("creates core Koan files and lazy state policy", async () => {
    await withTempProject(async (root) => {
      await ensureKoanProject(root);

      expect(await readText(join(root, "koan/README.md"))).toContain("Koan Project Memory");
      expect(await readText(join(root, "koan/goal.md"))).toContain("Active Goal");
      expect(await readText(join(root, ".koan/.gitignore"))).toBe(defaultKoanGitignore());

      const projectJson = await readText(join(root, ".koan/project.json"));
      expect(JSON.parse(projectJson).strictness).toBe("advisory");
    });
  });

  it("preserves existing AGENTS and CLAUDE content while adding Koan block", async () => {
    await withTempProject(async (root) => {
      await writeFile(join(root, "AGENTS.md"), "# Existing agent rules\n", "utf8");
      await writeFile(join(root, "CLAUDE.md"), "# Existing Claude rules\n", "utf8");

      await ensureKoanProject(root);
      await ensureKoanProject(root);

      const agents = await readText(join(root, "AGENTS.md"));
      const claude = await readText(join(root, "CLAUDE.md"));

      expect(agents).toContain("# Existing agent rules");
      expect(agents.match(/<!-- koan:start -->/g)).toHaveLength(1);
      expect(claude).toContain("# Existing Claude rules");
      expect(claude.match(/<!-- koan:start -->/g)).toHaveLength(1);
    });
  });

  it("inspects a non-initialized project", async () => {
    await withTempProject(async (root) => {
      const state = await inspectProject(root);
      expect(state.isKoanProject).toBe(false);
      expect(state.hasAgentsMd).toBe(false);
      expect(state.hasClaudeMd).toBe(false);
    });
  });

  it("fails initialization while a fresh live lock is held", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, ".koan"), { recursive: true });
      await writeFile(
        join(root, ".koan/write.lock"),
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        "utf8"
      );
      await expect(ensureKoanProject(root)).rejects.toThrow(KoanLockError);
    });
  });

  it("detects a project root from a nested directory", async () => {
    await withTempProject(async (root) => {
      const nested = join(root, "src/core");
      await mkdir(nested, { recursive: true });
      const state = await inspectProject(nested);
      expect(state.projectRoot).toBe(root);
    });
  });

  it("writes the default convergence threshold for a fresh project", async () => {
    await withTempProject(async (root) => {
      const config = await ensureKoanProject(root);
      expect(config.settings).toEqual({ convergenceThreshold: 0.7 });

      const stored = JSON.parse(await readText(join(root, ".koan/project.json")));
      expect(stored.settings).toEqual({ convergenceThreshold: 0.7 });
    });
  });

  it("preserves hand-edited config across reruns while refreshing the version", async () => {
    await withTempProject(async (root) => {
      await ensureKoanProject(root);

      const path = join(root, ".koan/project.json");
      const stored = JSON.parse(await readText(path));
      stored.koanVersion = "0.0.0";
      stored.strictness = "strict";
      stored.experimentalHandoff = true;
      stored.settings = { convergenceThreshold: 0.9 };
      await writeFile(path, `${JSON.stringify(stored)}\n`, "utf8");

      const config = await ensureKoanProject(root);
      expect(config.strictness).toBe("strict");
      expect(config.experimentalHandoff).toBe(true);
      expect(config.settings).toEqual({ convergenceThreshold: 0.9 });
      expect(config.koanVersion).toBe(KOAN_VERSION);
      expect(await loadProjectConfig(root)).toEqual(config);
    });
  });

  it("loads an old config without settings and yields the default", async () => {
    await withTempProject(async (root) => {
      await mkdir(join(root, ".koan"), { recursive: true });
      const legacy = {
        version: 1,
        koanVersion: "0.0.9",
        projectRoot: root,
        strictness: "advisory",
        experimentalHandoff: false,
        documents: {
          readme: "koan/README.md",
          goal: "koan/goal.md",
          status: "koan/status.md",
          plan: "koan/plan.md"
        }
      };
      await writeFile(join(root, ".koan/project.json"), `${JSON.stringify(legacy)}\n`, "utf8");

      const config = await loadProjectConfig(root);
      expect(config?.strictness).toBe("advisory");
      expect(config?.settings).toEqual({ convergenceThreshold: 0.7 });
    });
  });

  it("returns null from loadProjectConfig when missing or corrupt", async () => {
    await withTempProject(async (root) => {
      expect(await loadProjectConfig(root)).toBeNull();

      await mkdir(join(root, ".koan"), { recursive: true });
      await writeFile(join(root, ".koan/project.json"), "{not json", "utf8");
      expect(await loadProjectConfig(root)).toBeNull();
    });
  });
});
