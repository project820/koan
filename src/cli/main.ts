#!/usr/bin/env node
import { homedir } from "node:os";
import { acceptClarity, recordAnswer } from "../core/answers.js";
import {
  archive,
  brightIdea,
  handoff,
  hello,
  qa,
  recordInsight,
  status,
  updateStatus,
  type BrightIdeaClassification,
  type HelloResult
} from "../core/commands.js";
import { crystallize } from "../core/crystallize.js";
import { buildPrd } from "../core/prd.js";
import { runDashboard } from "./dashboard.js";
import { defaultProfile, loadProfile, resetProfile, saveProfile } from "../core/profile.js";
import { getQuestion, type KoanQuestion } from "../core/questions.js";
import { ANSWERED_CLARITY } from "../core/scoring.js";
import type { AmbiguityAxis } from "../core/schemas.js";
import { createPrompter, type Prompter } from "./prompt.js";

const BRIGHT_IDEA_CLASSIFICATIONS: readonly BrightIdeaClassification[] = [
  "clarify",
  "change-goal",
  "later-follow-up",
  "reject"
];

const DEVELOPMENT_UNDERSTANDING_OPTIONS = ["non_technical", "beginner", "intermediate", "expert"] as const;
const EXPLANATION_STYLE_OPTIONS = ["short", "example_first", "step_by_step", "technical_ok"] as const;
const LANGUAGE_OPTIONS = ["ko", "en", "mixed"] as const;
const OUTPUT_USE_OPTIONS = ["self_implementation", "agent_execution", "team_sharing", "learning"] as const;
const LEARNING_MODE_OPTIONS = ["approval_required", "auto_with_review"] as const;

// ---------------------------------------------------------------------------
// Central argument contract
//
// Every command declares its accepted leading flags and positional policy
// here, and main() funnels each command's raw arguments through
// parseCommandArgs below. Violations share one error shape — a stderr line
// plus usage, exit 1 — and are rejected before any state is read or written.
// ---------------------------------------------------------------------------

type PositionalPolicy =
  | "none" // any positional operand is rejected
  | "text" // positionals are the command's free text
  | "axis-then-text" // first positional is the axis, the rest free text
  | "none-unless-update-text"; // positionals allowed only as the --update text

interface CommandContract {
  flags: readonly string[];
  positionals: PositionalPolicy;
  /** Flags that are only meaningful when another flag is also present. */
  requires?: Readonly<Record<string, string>>;
}

const COMMAND_CONTRACTS = {
  hello: {
    flags: ["--interactive", "--setup", "--profile", "--reset-profile", "--yes"],
    positionals: "none",
    requires: { "--yes": "--reset-profile" }
  },
  status: { flags: ["--update", "--archive"], positionals: "none-unless-update-text" },
  answer: { flags: [], positionals: "axis-then-text" },
  enough: { flags: [], positionals: "none" },
  crystallize: { flags: ["--dry-run"], positionals: "none" },
  "bright-idea": { flags: ["--classify"], positionals: "text" },
  dashboard: { flags: ["--once"], positionals: "none" },
  insight: { flags: [], positionals: "text" },
  prd: { flags: ["--dry-run"], positionals: "none" },
  qa: { flags: [], positionals: "none" },
  handoff: { flags: [], positionals: "text" }
} as const satisfies Record<string, CommandContract>;

type ContractCommand = keyof typeof COMMAND_CONTRACTS;

let prompter: Prompter | null = null;

function getPrompter(): Prompter {
  prompter ??= createPrompter();
  return prompter;
}

function usage(): string {
  return [
    "Usage: koan <command>",
    "",
    "Commands:",
    "  hello [--interactive]      initialize or resume Koan; run the question loop",
    "  hello --setup              run guided profile setup",
    "  hello --profile            print the global profile (read-only)",
    "  hello --reset-profile      delete the global profile (--yes skips confirmation)",
    "  status                     show project status without writing by default",
    "  status --update <text>     record a status update",
    "  status --archive           archive the active goal",
    "  answer <axis> <text>       record an answer for an ambiguity axis",
    "  enough                     accept current clarity and stop questioning",
    "  crystallize [--dry-run]    write recorded answers into project documents",
    "  bright-idea [--classify <type>] <text>",
    "                             record a new idea without changing the plan",
    "  dashboard [--once]         live read-only view of clarity, goal, and insights",
    "  insight <text>             append a product realization to philosophy.md",
    "  prd [--dry-run]            synthesize koan/prd.md from recorded answers",
    "  qa                         create or refresh QA checklist",
    "  handoff <summary>          create document-based handoff",
    "                             (summaries beginning with \"--\" are unsupported)"
  ].join("\n");
}

async function runProfileSetup(prompt: Prompter, homeDir: string): Promise<void> {
  const profile = defaultProfile();
  let ended = false;

  const choose = async <T extends string>(question: string, options: readonly T[], fallback: T): Promise<T> => {
    if (ended) return fallback;
    const line = await prompt.ask(question);
    if (line === null) {
      ended = true;
      return fallback;
    }
    if (/^[0-9]+$/.test(line)) return options[Number.parseInt(line, 10) - 1] ?? fallback;
    return options.find((option) => option === line) ?? fallback;
  };

  profile.developmentUnderstanding = await choose(
    "Development understanding [1 non_technical / 2 beginner / 3 intermediate / 4 expert] (2): ",
    DEVELOPMENT_UNDERSTANDING_OPTIONS,
    profile.developmentUnderstanding
  );
  profile.explanationStyle = await choose(
    "Explanation style [1 short / 2 example_first / 3 step_by_step / 4 technical_ok] (2): ",
    EXPLANATION_STYLE_OPTIONS,
    profile.explanationStyle
  );
  profile.language = await choose("Language [1 ko / 2 en / 3 mixed] (1): ", LANGUAGE_OPTIONS, profile.language);
  profile.outputUse = await choose(
    "Output use [1 self_implementation / 2 agent_execution / 3 team_sharing / 4 learning] (2): ",
    OUTPUT_USE_OPTIONS,
    profile.outputUse
  );
  if (!ended) {
    const background = await prompt.ask("Domain background (free text, empty ok): ");
    if (background === null) ended = true;
    else profile.domainBackground = background;
  }
  profile.learningMode = await choose(
    "Learning mode [1 approval_required / 2 auto_with_review] (1): ",
    LEARNING_MODE_OPTIONS,
    profile.learningMode
  );

  await saveProfile(homeDir, profile);
  console.log("Profile saved.");
}

interface InteractiveHelloInput {
  cwd: string;
  homeDir: string;
  result: HelloResult;
  firstRun: boolean;
  prompt: Prompter;
}

async function runInteractiveHello(input: InteractiveHelloInput): Promise<number> {
  const { cwd, homeDir, result, prompt } = input;
  if (input.firstRun) await runProfileSetup(prompt, homeDir);
  const profile = (await loadProfile(homeDir)) ?? defaultProfile();

  let question: KoanQuestion | null = result.nextQuestion
    ? getQuestion(result.nextQuestion.axis, profile)
    : null;

  if (result.resumed && result.lastAnswer) {
    console.log(`Last answer (${result.lastAnswer.axis}): ${result.lastAnswer.answer}`);
    let resumeChoice: "continue" | "revise" | "stop" | null = null;
    while (resumeChoice === null) {
      const choice = await prompt.ask("Resume: [c]ontinue, [r]evise last answer, [s]top? ");
      if (choice === null || choice === "s") resumeChoice = "stop";
      else if (choice === "r") resumeChoice = "revise";
      else if (choice === "c" || choice === "") resumeChoice = "continue";
      else console.log(`Unrecognized choice: ${choice}`);
    }
    if (resumeChoice === "stop") {
      console.log("Stopped. Run koan hello to continue.");
      return 0;
    }
    if (resumeChoice === "revise") question = getQuestion(result.lastAnswer.axis, profile);
  }

  while (question) {
    console.log(question.userFacingQuestion);
    const line = await prompt.ask("> ");
    if (line === null || line === "stop" || line === "quit") {
      console.log("Stopped. Run koan hello to continue.");
      return 0;
    }
    if (line === "enough") {
      await acceptClarity({ cwd });
      console.log("Accepted current clarity.");
      break;
    }
    if (line === "") continue;
    const recorded = await recordAnswer({ cwd, homeDir, axis: question.axis, answer: line });
    console.log(`Recorded ${question.axis} (clarity ${ANSWERED_CLARITY}).`);
    if (recorded.converged) console.log("All axes converged.");
    question = recorded.nextQuestion;
  }

  const crystallized = await crystallize({ cwd, homeDir });
  console.log(`Crystallized ${crystallized.crystallizedAxes.length} axes.`);
  console.log("Session complete.");
  return 0;
}

// Flags are positional: they are only recognized in the leading run of --*
// tokens. The first token that does not start with -- begins free text, and
// every later token (even ones starting with --) is text verbatim.
interface LeadingFlags {
  flags: string[];
  text: string[];
  unknown: string | null;
}

function parseLeadingFlags(args: string[], known: readonly string[]): LeadingFlags {
  const flags: string[] = [];
  let index = 0;
  while (index < args.length && args[index].startsWith("--")) {
    const token = args[index];
    if (!known.includes(token)) return { flags, text: args.slice(index), unknown: token };
    flags.push(token);
    index += 1;
  }
  return { flags, text: args.slice(index), unknown: null };
}

interface ParsedArgs {
  flags: string[];
  text: string[];
}

function contractViolation(message: string): null {
  console.error(message);
  console.error(usage());
  return null;
}

// Shared contract enforcement for every command: unknown leading flags,
// unexpected positional operands, and flag dependencies are all rejected here
// (null is returned after printing the error) before any handler runs.
function parseCommandArgs(command: ContractCommand, args: string[]): ParsedArgs | null {
  const contract: CommandContract = COMMAND_CONTRACTS[command];
  const parsed = parseLeadingFlags(args, contract.flags);
  if (parsed.unknown !== null) {
    return contractViolation(`Unknown flag for koan ${command}: ${parsed.unknown}`);
  }
  const textAllowed =
    contract.positionals === "text" ||
    contract.positionals === "axis-then-text" ||
    (contract.positionals === "none-unless-update-text" && parsed.flags.includes("--update"));
  if (!textAllowed && parsed.text.length > 0) {
    return contractViolation(`Unexpected argument for koan ${command}: ${parsed.text[0]}`);
  }
  for (const [flag, dependency] of Object.entries(contract.requires ?? {})) {
    if (parsed.flags.includes(flag) && !parsed.flags.includes(dependency)) {
      console.error(`${flag} requires ${dependency}.`);
      return null;
    }
  }
  return { flags: parsed.flags, text: parsed.text };
}

// hello mode flags select one exclusive behavior; --interactive only applies
// to the question loop, so combining it with any mode flag is an error too
// (--setup exits after saving the profile and never enters the loop).
const HELLO_MODE_FLAGS = ["--setup", "--profile", "--reset-profile"] as const;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();
  const homeDir = process.env.HOME ?? homedir();

  if (command === "hello") {
    const parsed = parseCommandArgs("hello", rest);
    if (parsed === null) return 1;
    const flags = parsed.flags;
    const modeFlags = HELLO_MODE_FLAGS.filter((flag) => flags.includes(flag));
    if (modeFlags.length > 1 || (modeFlags.length > 0 && flags.includes("--interactive"))) {
      console.error("Use only one of --setup, --profile, --reset-profile.");
      return 1;
    }
    const interactive = process.stdin.isTTY === true || flags.includes("--interactive");

    if (flags.includes("--profile")) {
      const profile = await loadProfile(homeDir);
      console.log(JSON.stringify(profile ?? defaultProfile(), null, 2));
      return 0;
    }

    if (flags.includes("--reset-profile")) {
      if (!flags.includes("--yes")) {
        if (process.stdin.isTTY !== true) {
          console.error("Refusing to reset the profile without --yes in non-interactive mode.");
          return 1;
        }
        const confirmation = await getPrompter().ask("Delete the global profile? [y/N] ");
        if (confirmation !== "y" && confirmation !== "yes") return 0;
      }
      await resetProfile(homeDir);
      console.log("Profile reset.");
      return 0;
    }

    if (flags.includes("--setup")) {
      await runProfileSetup(getPrompter(), homeDir);
      return 0;
    }

    const hadProfile = (await loadProfile(homeDir)) !== null;
    const result = await hello({ cwd, homeDir });
    console.log(`Koan ready: ${result.projectRoot}`);
    if (!interactive) {
      if (result.nextQuestion) console.log(result.nextQuestion.userFacingQuestion);
      return 0;
    }
    return runInteractiveHello({ cwd, homeDir, result, firstRun: !hadProfile, prompt: getPrompter() });
  }

  if (command === "status") {
    const parsed = parseCommandArgs("status", rest);
    if (parsed === null) return 1;
    const wantsArchive = parsed.flags.includes("--archive");
    const wantsUpdate = parsed.flags.includes("--update");
    if (wantsArchive && wantsUpdate) {
      console.error("Use either --update or --archive, not both.");
      return 1;
    }

    if (wantsArchive) {
      const result = await archive({ cwd });
      console.log(`Archived ${result.archivedGoalId}.`);
      return 0;
    }

    if (wantsUpdate) {
      let update = parsed.text.join(" ").trim();
      if (!update) {
        if (process.stdin.isTTY !== true) {
          console.error("Usage: koan status --update <text>");
          return 1;
        }
        update = (await getPrompter().ask("Status update: ")) ?? "";
      }
      await updateStatus({ cwd, update });
      console.log("Status updated.");
      return 0;
    }

    const result = await status({ cwd });
    console.log(result.summary);
    return 0;
  }

  if (command === "answer") {
    // No leading flags: the axis is the first positional and everything after
    // it is free text verbatim (flag-like tokens included).
    const parsed = parseCommandArgs("answer", rest);
    if (parsed === null) return 1;
    const [axis, ...answerWords] = parsed.text;
    const answer = answerWords.join(" ").trim();
    if (!axis || !answer) {
      console.error("Usage: koan answer <axis> <text>");
      return 1;
    }
    const result = await recordAnswer({ cwd, homeDir, axis: axis as AmbiguityAxis, answer });
    console.log(`Recorded ${result.answer.axis}. Next: ${result.nextQuestion?.axis ?? "converged"}.`);
    return 0;
  }

  if (command === "enough") {
    if (parseCommandArgs("enough", rest) === null) return 1;
    await acceptClarity({ cwd });
    console.log("Accepted current clarity.");
    return 0;
  }

  if (command === "crystallize") {
    const parsed = parseCommandArgs("crystallize", rest);
    if (parsed === null) return 1;
    const dryRun = parsed.flags.includes("--dry-run");
    const result = await crystallize({ cwd, homeDir, dryRun });
    if (dryRun) {
      console.log(`Dry run: ${result.plan.operations.length} operations planned.`);
      return 0;
    }
    console.log(`Crystallized ${result.crystallizedAxes.length} axes.`);
    return 0;
  }

  if (command === "bright-idea") {
    // --classify is the only leading flag; its value is the first non-flag
    // token, and everything after that value is idea text verbatim.
    const parsed = parseCommandArgs("bright-idea", rest);
    if (parsed === null) return 1;
    let classification: BrightIdeaClassification | undefined;
    let ideaWords = parsed.text;
    if (parsed.flags.includes("--classify")) {
      const value = ideaWords[0];
      if (!BRIGHT_IDEA_CLASSIFICATIONS.includes(value as BrightIdeaClassification)) {
        console.error(`Invalid classification: ${value}`);
        return 1;
      }
      classification = value as BrightIdeaClassification;
      ideaWords = ideaWords.slice(1);
    }
    const idea = ideaWords.join(" ").trim();
    if (!idea) {
      console.error("Usage: koan bright-idea <text>");
      return 1;
    }
    const result = await brightIdea({ cwd, idea, classification });
    console.log(`Bright idea recorded (${result.classification}). ${result.recommendation}`);
    return 0;
  }

  if (command === "dashboard") {
    const parsed = parseCommandArgs("dashboard", rest);
    if (parsed === null) return 1;
    return runDashboard({ cwd, homeDir, once: parsed.flags.includes("--once") });
  }

  if (command === "insight") {
    const parsed = parseCommandArgs("insight", rest);
    if (parsed === null) return 1;
    const text = parsed.text.join(" ").trim();
    if (!text) {
      console.error("Usage: koan insight <text>");
      return 1;
    }
    const result = await recordInsight({ cwd, text });
    console.log(`Insight recorded in ${result.path}.`);
    return 0;
  }

  if (command === "prd") {
    const parsed = parseCommandArgs("prd", rest);
    if (parsed === null) return 1;
    const dryRun = parsed.flags.includes("--dry-run");
    const result = await buildPrd({ cwd, homeDir, dryRun });
    if (dryRun) {
      console.log(`Dry run: ${result.plan.operations.length} operations planned.`);
      return 0;
    }
    console.log(`PRD synthesized at ${result.path}.`);
    return 0;
  }

  if (command === "qa") {
    if (parseCommandArgs("qa", rest) === null) return 1;
    await qa({ cwd });
    console.log("QA checklist ready.");
    return 0;
  }

  if (command === "handoff") {
    // No leading flags; the summary is everything after them, verbatim. A
    // summary that itself begins with "--" is therefore unsupported (see
    // usage), but later tokens may look like flags.
    const parsed = parseCommandArgs("handoff", rest);
    if (parsed === null) return 1;
    const summary = parsed.text.join(" ").trim();
    if (!summary) {
      console.error("Usage: koan handoff <summary>");
      return 1;
    }
    await handoff({ cwd, summary });
    console.log("Handoff ready.");
    return 0;
  }

  console.error(usage());
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    prompter?.close();
  });
