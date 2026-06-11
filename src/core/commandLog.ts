import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { ensureStateGitignore } from "./gitPolicy.js";
import { CommandLogEntrySchema, CommandLogSchema, type CommandLog } from "./schemas.js";
import { withFileLock } from "./lock.js";

const COMMAND_LOG_LIMIT = 500;

function freshCommandLog(): CommandLog {
  return { version: 1, entries: [] };
}

async function readCommandLog(path: string): Promise<CommandLog> {
  try {
    const raw = await readFile(path, "utf8");
    return CommandLogSchema.parse(JSON.parse(raw));
  } catch {
    return freshCommandLog();
  }
}

export async function loadCommandLog(projectRoot: string): Promise<CommandLog> {
  return readCommandLog(join(projectRoot, STATE_FILES.commandLog));
}

export async function appendCommandLog(
  projectRoot: string,
  entry: { command: string; summary: string },
  isoDate = new Date().toISOString()
): Promise<CommandLog> {
  const path = join(projectRoot, STATE_FILES.commandLog);
  const parsed = CommandLogEntrySchema.parse({ at: isoDate, command: entry.command, summary: entry.summary });

  return withFileLock(projectRoot, async () => {
    const current = await readCommandLog(path);
    const next: CommandLog = {
      version: 1,
      entries: [...current.entries, parsed].slice(-COMMAND_LOG_LIMIT)
    };
    await ensureStateGitignore(projectRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  });
}
