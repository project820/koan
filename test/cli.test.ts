import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTempProject } from "./helpers/fs.js";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const tsxPath = createRequire(import.meta.url).resolve("tsx");

describe("CLI", () => {
  it("prints status help for unknown command", async () => {
    const result = await execFileAsync("node", ["--import", "tsx", "src/cli/main.ts", "unknown"], {
      cwd: process.cwd()
    }).catch((error: { stdout: string; stderr: string; code: number }) => error);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: koan");
  });

  it("runs hello in a project", async () => {
    await withTempProject(async (root) => {
      const result = await execFileAsync("node", ["--import", tsxPath, cliPath, "hello"], {
        cwd: root,
        env: { ...process.env, HOME: root }
      });
      expect(result.stdout).toContain("Koan ready");
    });
  });
});
