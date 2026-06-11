import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultKoanGitignore } from "../src/core/gitPolicy.js";
import { ensureKoanProject, inspectProject } from "../src/core/project.js";
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

  it("detects a project root from a nested directory", async () => {
    await withTempProject(async (root) => {
      const nested = join(root, "src/core");
      await mkdir(nested, { recursive: true });
      const state = await inspectProject(nested);
      expect(state.projectRoot).toBe(root);
    });
  });
});
