#!/usr/bin/env node
import { homedir } from "node:os";
import { acceptClarity, recordAnswer } from "../core/answers.js";
import {
  archive,
  brightIdea,
  handoff,
  hello,
  qa,
  status,
  updateStatus,
  type BrightIdeaClassification,
  type HelloResult
} from "../core/commands.js";
import { crystallize } from "../core/crystallize.js";
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

function rejectUnknownFlag(command: string, token: string): number {
  console.error(`Unknown flag for koan ${command}: ${token}`);
  console.error(usage());
  return 1;
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
    const parsed = parseLeadingFlags(rest, [
      "--interactive",
      "--profile",
      "--reset-profile",
      "--yes",
      "--setup"
    ]);
    if (parsed.unknown !== null) return rejectUnknownFlag("hello", parsed.unknown);
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
    const parsed = parseLeadingFlags(rest, ["--archive", "--update"]);
    if (parsed.unknown !== null) return rejectUnknownFlag("status", parsed.unknown);
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
    const parsed = parseLeadingFlags(rest, []);
    if (parsed.unknown !== null) return rejectUnknownFlag("answer", parsed.unknown);
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
    const parsed = parseLeadingFlags(rest, []);
    if (parsed.unknown !== null) return rejectUnknownFlag("enough", parsed.unknown);
    await acceptClarity({ cwd });
    console.log("Accepted current clarity.");
    return 0;
  }

  if (command === "crystallize") {
    const parsed = parseLeadingFlags(rest, ["--dry-run"]);
    if (parsed.unknown !== null) return rejectUnknownFlag("crystallize", parsed.unknown);
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
    const parsed = parseLeadingFlags(rest, ["--classify"]);
    if (parsed.unknown !== null) return rejectUnknownFlag("bright-idea", parsed.unknown);
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

  if (command === "qa") {
    const parsed = parseLeadingFlags(rest, []);
    if (parsed.unknown !== null) return rejectUnknownFlag("qa", parsed.unknown);
    await qa({ cwd });
    console.log("QA checklist ready.");
    return 0;
  }

  if (command === "handoff") {
    // No leading flags; the summary is everything after them, verbatim. A
    // summary that itself begins with "--" is therefore unsupported (see
    // usage), but later tokens may look like flags.
    const parsed = parseLeadingFlags(rest, []);
    if (parsed.unknown !== null) return rejectUnknownFlag("handoff", parsed.unknown);
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
