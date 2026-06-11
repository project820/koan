import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { ensureStateGitignore } from "./gitPolicy.js";
import { CommandLogEntrySchema, CommandLogSchema, type CommandLog } from "./schemas.js";
import { withFileLock } from "./lock.js";

const COMMAND_LOG_LIMIT = 500;

export interface CommandLogInput {
  command: string;
  summary: string;
}

function freshCommandLog(): CommandLog {
  return { version: 1, entries: [] };
}

export async function loadCommandLog(projectRoot: string): Promise<CommandLog> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.commandLog), "utf8");
    return CommandLogSchema.parse(JSON.parse(raw));
  } catch {
    return freshCommandLog();
  }
}

// Caller must hold the project write lock.
export async function appendCommandLogInLock(
  projectRoot: string,
  entry: CommandLogInput,
  isoDate = new Date().toISOString()
): Promise<CommandLog> {
  const path = join(projectRoot, STATE_FILES.commandLog);
  const parsed = CommandLogEntrySchema.parse({ at: isoDate, command: entry.command, summary: entry.summary });

  let current = freshCommandLog();
  let raw: string | null = null;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    raw = null;
  }
  if (raw !== null) {
    try {
      current = CommandLogSchema.parse(JSON.parse(raw));
    } catch {
      await writeFile(`${path}.bak`, raw, "utf8");
    }
  }

  const next: CommandLog = {
    version: 1,
    entries: [...current.entries, parsed].slice(-COMMAND_LOG_LIMIT)
  };
  await ensureStateGitignore(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function appendCommandLog(
  projectRoot: string,
  entry: CommandLogInput,
  isoDate = new Date().toISOString()
): Promise<CommandLog> {
  return withFileLock(projectRoot, () => appendCommandLogInLock(projectRoot, entry, isoDate));
}
