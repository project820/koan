import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPrompter } from "../src/cli/prompt.js";
import { AmbiguityAxisSchema } from "../src/core/schemas.js";
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
      expect(statusResult.stdout).toContain("Next action: archive the completed goal (koan status --archive)");
    });
  });

  it("interactive resume revises the last answer", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await seedProfile(home);
      await runCli(["hello"], { cwd: root, home });
      await runCli(["answer", "purpose", "Original", "answer"], { cwd: root, home });

      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: "r\nRevised purpose answer\nstop\n"
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Last answer (purpose):");
      expect(result.stdout).toContain("Recorded purpose (clarity 0.8).");

      const state = JSON.parse(await readFile(join(root, ".koan/session-state.json"), "utf8"));
      const purposeAnswers = state.answers.filter(
        (entry: { axis: string; answer: string }) => entry.axis === "purpose"
      );
      expect(purposeAnswers.at(-1)?.answer).toBe("Revised purpose answer");
    });
  });

  it("interactive loop converges after answering every axis", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await seedProfile(home);

      const answers = AmbiguityAxisSchema.options.map((axis, index) => `Answer ${index + 1} for ${axis}`);
      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: `${answers.join("\n")}\n`
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("All axes converged.");
      expect(result.stdout).toContain("Session complete.");
    });
  });

  it("re-asks the resume prompt on an unrecognized choice", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await seedProfile(home);
      await runCli(["hello"], { cwd: root, home });
      await runCli(["answer", "purpose", "Original", "answer"], { cwd: root, home });

      const result = await runCli(["hello", "--interactive"], {
        cwd: root,
        home,
        input: "x\ns\n"
      });

      expect(result.code).toBe(0);
      const resumePrompt = "Resume: [c]ontinue, [r]evise last answer, [s]top?";
      expect(result.stdout.split(resumePrompt).length - 1).toBe(2);
      expect(result.stdout).toContain("Stopped. Run koan hello to continue.");
      expect(result.stdout).not.toContain("Recorded");
    });
  });

  it("status rejects --update combined with --archive as leading flags", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const both = await runCli(["status", "--update", "--archive"], { cwd: root, home });
      expect(both.code).toBe(1);
      expect(both.stderr).toContain("Use either --update or --archive, not both.");

      const reversed = await runCli(["status", "--archive", "--update", "x"], { cwd: root, home });
      expect(reversed.code).toBe(1);
      expect(reversed.stderr).toContain("Use either --update or --archive, not both.");

      // Neither invocation may archive the goal as a side effect.
      const after = await runCli(["status"], { cwd: root, home });
      expect(after.code).toBe(0);
      expect(after.stdout).not.toContain("run koan hello to start a new goal");
    });
  });

  it("status --update keeps a trailing --archive token as text and does not archive", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["status", "--update", "Parser", "done", "--archive"], {
        cwd: root,
        home
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Status updated.");
      expect(result.stdout).not.toContain("Archived");

      const statusDoc = await readFile(join(root, "koan/status.md"), "utf8");
      expect(managedSection(statusDoc, "current-status")).toContain("Parser done --archive");

      const after = await runCli(["status"], { cwd: root, home });
      expect(after.code).toBe(0);
      expect(after.stdout).not.toContain("run koan hello to start a new goal");
      expect(after.stdout).toContain("Next action: answer the");
    });
  });

  it("hello rejects unknown leading flags without writing state", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "--reset-profil"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan hello: --reset-profil");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan"))).toBe(false);
      expect(await fileExists(join(root, ".koan"))).toBe(false);
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
    });
  });

  it("status rejects unknown leading flags", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["status", "--archve"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan status: --archve");
      expect(result.stderr).toContain("Usage: koan");
    });
  });

  it("answer keeps tokens that look like flags inside free text", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["answer", "scope", "use", "--interactive", "mode"], {
        cwd: root,
        home
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Recorded scope.");

      const state = JSON.parse(await readFile(join(root, ".koan/session-state.json"), "utf8"));
      const scopeAnswer = state.answers
        .filter((entry: { axis: string; answer: string }) => entry.axis === "scope")
        .at(-1);
      expect(scopeAnswer?.answer).toBe("use --interactive mode");
    });
  });

  it("enough rejects leading flags without touching session state", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const statePath = join(root, ".koan/session-state.json");
      const before = await readFile(statePath);

      const result = await runCli(["enough", "--dry-run"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan enough: --dry-run");
      expect(result.stderr).toContain("Usage: koan");

      const after = await readFile(statePath);
      expect(after.equals(before)).toBe(true);
    });
  });

  it("crystallize rejects unknown leading flags without writing documents", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });
      await runCli(["answer", "purpose", "Typo", "guard", "answer"], { cwd: root, home });

      const goalPath = join(root, "koan/goal.md");
      const before = await readFile(goalPath, "utf8");

      const result = await runCli(["crystallize", "--dr-run"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan crystallize: --dr-run");
      expect(result.stderr).toContain("Usage: koan");
      expect(await readFile(goalPath, "utf8")).toBe(before);
    });
  });

  it("qa rejects leading flags without creating the checklist", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["qa", "--x"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan qa: --x");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan/qa.md"))).toBe(false);
    });
  });

  it("answer rejects leading flags before the axis", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const statePath = join(root, ".koan/session-state.json");
      const before = await readFile(statePath);

      const result = await runCli(["answer", "--x", "purpose", "text"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan answer: --x");
      expect(result.stderr).toContain("Usage: koan");

      const after = await readFile(statePath);
      expect(after.equals(before)).toBe(true);
    });
  });

  it("bright-idea keeps flag-like tokens after the classification value as free text", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["bright-idea", "--classify", "reject", "--extra"], {
        cwd: root,
        home
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Bright idea recorded (reject).");

      const ideas = await readFile(join(root, "koan/bright-ideas.md"), "utf8");
      expect(ideas).toContain("Classification: reject");
      expect(ideas).toMatch(/^--extra$/m);
    });
  });

  it("bright-idea rejects unknown leading flags", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["bright-idea", "--bogus", "Idea", "text"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan bright-idea: --bogus");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan/bright-ideas.md"))).toBe(false);
    });
  });

  it("handoff rejects leading flags instead of treating them as summary", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["handoff", "--x", "real", "summary"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unknown flag for koan handoff: --x");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan/handoff.md"))).toBe(false);
    });
  });

  it("enough rejects unexpected positional operands without touching session state", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const statePath = join(root, ".koan/session-state.json");
      const before = await readFile(statePath);

      const result = await runCli(["enough", "extra"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unexpected argument for koan enough: extra");
      expect(result.stderr).toContain("Usage: koan");

      const after = await readFile(statePath);
      expect(after.equals(before)).toBe(true);
    });
  });

  it("crystallize rejects unexpected positional operands without writing documents", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });
      await runCli(["answer", "purpose", "Positional", "guard", "answer"], { cwd: root, home });

      const goalPath = join(root, "koan/goal.md");
      const before = await readFile(goalPath, "utf8");

      const result = await runCli(["crystallize", "extra"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unexpected argument for koan crystallize: extra");
      expect(result.stderr).toContain("Usage: koan");
      expect(await readFile(goalPath, "utf8")).toBe(before);
    });
  });

  it("crystallize --dry-run rejects unexpected positional operands", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["crystallize", "--dry-run", "extra"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unexpected argument for koan crystallize: extra");
      expect(result.stderr).toContain("Usage: koan");
    });
  });

  it("qa rejects unexpected positional operands without creating the checklist", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const result = await runCli(["qa", "extra"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unexpected argument for koan qa: extra");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan/qa.md"))).toBe(false);
    });
  });

  it("status rejects positional operands unless they follow --update", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);
      await runCli(["hello"], { cwd: root, home });

      const bare = await runCli(["status", "extra"], { cwd: root, home });
      expect(bare.code).toBe(1);
      expect(bare.stderr).toContain("Unexpected argument for koan status: extra");
      expect(bare.stderr).toContain("Usage: koan");

      const archive = await runCli(["status", "--archive", "extra"], { cwd: root, home });
      expect(archive.code).toBe(1);
      expect(archive.stderr).toContain("Unexpected argument for koan status: extra");

      // Neither invocation may archive the goal as a side effect.
      const after = await runCli(["status"], { cwd: root, home });
      expect(after.code).toBe(0);
      expect(after.stdout).toContain("Next action: answer the");
    });
  });

  it("hello rejects unexpected positional operands without writing state", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "extra"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Unexpected argument for koan hello: extra");
      expect(result.stderr).toContain("Usage: koan");
      expect(await fileExists(join(root, "koan"))).toBe(false);
      expect(await fileExists(join(root, ".koan"))).toBe(false);
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
    });
  });

  it("hello --yes without --reset-profile is rejected", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      for (const args of [
        ["hello", "--yes"],
        ["hello", "--setup", "--yes"]
      ]) {
        const result = await runCli(args, { cwd: root, home });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("--yes requires --reset-profile.");
      }
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
      expect(await fileExists(join(root, "koan"))).toBe(false);
    });
  });

  it("hello rejects combined mode flags", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      const result = await runCli(["hello", "--profile", "--setup"], { cwd: root, home });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Use only one of --setup, --profile, --reset-profile.");
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
      expect(await fileExists(join(root, "koan"))).toBe(false);
    });
  });

  it("hello rejects mode flags combined with --interactive", async () => {
    await withTempProject(async (root) => {
      const home = await makeHome(root);

      // --setup --interactive is rejected too: --setup exits after saving the
      // profile, so there is no setup-then-loop flow for --interactive to join.
      for (const args of [
        ["hello", "--profile", "--interactive"],
        ["hello", "--reset-profile", "--interactive"],
        ["hello", "--setup", "--interactive"]
      ]) {
        const result = await runCli(args, { cwd: root, home });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("Use only one of --setup, --profile, --reset-profile.");
      }
      expect(await fileExists(join(home, ".koan/profile.json"))).toBe(false);
      expect(await fileExists(join(root, "koan"))).toBe(false);
    });
  });
});

describe("prompter", () => {
  it("settles concurrent asks in FIFO order and resolves all pending on close", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const prompter = createPrompter(input, output);

    const first = prompter.ask("first? ");
    const second = prompter.ask("second? ");
    input.write("one\ntwo\n");
    expect(await first).toBe("one");
    expect(await second).toBe("two");

    const third = prompter.ask("third? ");
    const fourth = prompter.ask("fourth? ");
    input.end();
    expect(await third).toBeNull();
    expect(await fourth).toBeNull();
    prompter.close();
  });
});
