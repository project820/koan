import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTempProject } from "./helpers/fs.js";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const tsxPath = createRequire(import.meta.url).resolve("tsx");

interface RunCliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(
  args: string[],
  options: { cwd: string; home: string; input?: string }
): Promise<RunCliResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("node", ["--import", tsxPath, cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, HOME: options.home }
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      resolveRun({ stdout, stderr, code: code ?? -1 });
    });

    // Non-interactive commands can exit before draining piped stdin; swallow
    // the resulting EPIPE instead of crashing the test process.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

// Separate HOME dir inside the temp root so the global profile (~/.koan) never
// collides with the project state dir (<root>/.koan).
async function makeHome(root: string): Promise<string> {
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  return home;
}

const SEED_PROFILE = {
  developmentUnderstanding: "beginner",
  explanationStyle: "example_first",
  language: "en",
  outputUse: "agent_execution",
  domainBackground: "",
  learningMode: "approval_required"
};

async function seedProfile(home: string): Promise<void> {
  await mkdir(join(home, ".koan"), { recursive: true });
  await writeFile(
    join(home, ".koan/profile.json"),
    `${JSON.stringify(SEED_PROFILE, null, 2)}\n`,
    "utf8"
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function managedSection(text: string, name: string): string {
  const startMarker = `<!-- koan:section:start name="${name}" -->`;
  const endMarker = `<!-- koan:section:end name="${name}" -->`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return "";
  return text.slice(start + startMarker.length, end).trim();
}

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

describe("CLI contract", () => {
  it("interactive loop records an answer and crystallizes on enough", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await seedProfile(home);

      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: "Purpose answer line\nenough\n"
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Koan ready:");
      expect(result.stdout).not.toContain("Profile saved.");
      expect(result.stdout).toContain("Recorded purpose (clarity 0.8).");
      expect(result.stdout).toMatch(/Crystallized \d+ axes\./);
      expect(result.stdout).toContain("Session complete.");

      const goal = await readFile(join(root, "koan/goal.md"), "utf8");
      expect(managedSection(goal, "purpose")).toContain("Purpose answer line");
    });
  });

  it("interactive first run performs profile setup before the loop", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: `${"\n".repeat(6)}stop\n`
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Profile saved.");
      expect(result.stdout).toContain("Stopped. Run koan hello to continue.");

      const profile = JSON.parse(await readFile(join(home, ".koan/profile.json"), "utf8"));
      expect(profile.language).toBe("ko");
    });
  });

  it("interactive loop stops without crystallizing on stop", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await seedProfile(home);

      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: "stop\n"
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Stopped. Run koan hello to continue.");
      expect(result.stdout).not.toContain("Crystallized");
    });
  });

  it("hello --profile prints defaults without writing anywhere", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "--profile"], { cwd: root, home });

      expect(result.code).toBe(0);
      const profile = JSON.parse(result.stdout);
      expect(profile.learningMode).toBe("approval_required");
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
      expect(await fileExists(join(root, "koan"))).toBe(false);
    });
  });

  it("hello --setup saves defaults for empty answers", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "--setup"], {
        cwd: root,
        home,
        input: "\n".repeat(6)
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Profile saved.");

      const profile = JSON.parse(await readFile(join(home, ".koan/profile.json"), "utf8"));
      expect(profile.language).toBe("ko");
      expect(profile.learningMode).toBe("approval_required");
    });
  });

  it("hello --reset-profile requires --yes in non-interactive mode", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(true);

      const refused = await runCli(["hello", "--reset-profile"], { cwd: root, home });
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(
        "Refusing to reset the profile without --yes in non-interactive mode."
      );
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(true);

      const reset = await runCli(["hello", "--reset-profile", "--yes"], { cwd: root, home });
      expect(reset.code).toBe(0);
      expect(reset.stdout).toContain("Profile reset.");
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
    });
  });

  it("status --update writes the managed status regions", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["status", "--update", "Parser", "done"], { cwd: root, home });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Status updated.");

      const statusDoc = await readFile(join(root, "koan/status.md"), "utf8");
      expect(managedSection(statusDoc, "current-status")).toContain("Parser done");

      const handoffDoc = await readFile(join(root, "koan/handoff.md"), "utf8");
      expect(managedSection(handoffDoc, "latest-status")).toContain("Parser done");

      const log = JSON.parse(await readFile(join(root, ".koan/command-log.json"), "utf8"));
      expect(
        log.entries.some((entry: { command: string }) => entry.command === "koan status")
      ).toBe(true);
    });
  });

  it("status --archive archives once and then fails", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const archived = await runCli(["status", "--archive"], { cwd: root, home });
      expect(archived.code).toBe(0);
      expect(archived.stdout).toMatch(/^Archived goal-/m);

      const again = await runCli(["status", "--archive"], { cwd: root, home });
      expect(again.code).toBe(1);
      expect(again.stderr).toContain("No active goal to archive.");
    });
  });

  it("answer records clarity and crystallize writes goal.md", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const answered = await runCli(["answer", "purpose", "Build", "agent", "memory"], {
        cwd: root,
        home
      });
      expect(answered.code).toBe(0);
      expect(answered.stdout).toContain("Recorded purpose. Next:");

      const ledger = JSON.parse(
        await readFile(join(root, ".koan/ambiguity-ledger.json"), "utf8")
      );
      const purpose = ledger.axes.find((entry: { axis: string }) => entry.axis === "purpose");
      expect(purpose?.clarity).toBe(0.8);

      const crystallized = await runCli(["crystallize"], { cwd: root, home });
      expect(crystallized.code).toBe(0);
      expect(crystallized.stdout).toMatch(/Crystallized \d+ axes\./);

      const goal = await readFile(join(root, "koan/goal.md"), "utf8");
      expect(managedSection(goal, "purpose")).toContain("Build agent memory");
    });
  });

  it("answer without arguments fails with usage", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["answer"], { cwd: root, home });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage");
    });
  });

  it("crystallize --dry-run plans without writing", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });
      await runCli(["answer", "purpose", "Dry", "run", "answer"], { cwd: root, home });

      const goalPath = join(root, "koan/goal.md");
      const before = await readFile(goalPath, "utf8");

      const result = await runCli(["crystallize", "--dry-run"], { cwd: root, home });

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Dry run: \d+ operations planned\./);

      expect(await readFile(goalPath, "utf8")).toBe(before);
      expect(await fileExists(join(root, "koan/decisions.md"))).toBe(false);
    });
  });

  it("bright-idea records classification and rejects invalid values", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const rejected = await runCli(["bright-idea", "--classify", "reject", "Drop", "this"], {
        cwd: root,
        home
      });
      expect(rejected.code).toBe(0);
      expect(rejected.stdout).toContain(
        "Bright idea recorded (reject). Recorded for reference; no action planned."
      );

      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Classification: reject");
      expect(ideas).toContain("Drop this");

      const invalid = await runCli(["bright-idea", "--classify", "wild", "Drop", "this"], {
        cwd: root,
        home
      });
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain("Invalid classification: wild");
    });
  });

  it("bright-idea defaults to later-follow-up", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["bright-idea", "Plain", "default", "idea"], {
        cwd: root,
        home
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Bright idea recorded (later-follow-up).");

      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Classification: later-follow-up");
      expect(ideas).toContain("Plain default idea");
    });
  });

  it("enough accepts clarity and status recommends archiving", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["enough"], { cwd: root, home });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Accepted current clarity.");

      const statusResult = await runCli(["status"], { cwd: root, home });
      expect(statusResult.code).toBe(0);
      expect(statusResult.stdout).toContain("Next action: archive the completed goal");
    });
  });
});
