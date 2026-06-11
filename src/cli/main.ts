#!/usr/bin/env node
import { homedir } from "node:os";
import { brightIdea, handoff, hello, qa, status } from "../core/commands.js";

function usage(): string {
  return [
    "Usage: koan <command>",
    "",
    "Commands:",
    "  hello                 initialize or resume Koan in this project",
    "  status                show project status without writing by default",
    "  bright-idea <text>    record a new idea without changing the plan",
    "  qa                    create or refresh QA checklist",
    "  handoff <summary>     create document-based handoff"
  ].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();
  const homeDir = process.env.HOME ?? homedir();

  if (command === "hello") {
    const result = await hello({ cwd, homeDir });
    console.log(`Koan ready: ${result.projectRoot}`);
    if (result.nextQuestion) console.log(result.nextQuestion.userFacingQuestion);
    return 0;
  }

  if (command === "status") {
    const result = await status({ cwd });
    console.log(result.summary);
    return 0;
  }

  if (command === "bright-idea") {
    const idea = rest.join(" ").trim();
    if (!idea) {
      console.error("Usage: koan bright-idea <text>");
      return 1;
    }
    await brightIdea({ cwd, idea });
    console.log("Bright idea recorded.");
    return 0;
  }

  if (command === "qa") {
    await qa({ cwd });
    console.log("QA checklist ready.");
    return 0;
  }

  if (command === "handoff") {
    const summary = rest.join(" ").trim();
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
  });
