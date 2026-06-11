import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";

export function defaultKoanGitignore(): string {
  return [
    "user-profile-ref.json",
    "session-state.json",
    "ambiguity-ledger.json",
    "command-log.json",
    "mcp-cache.json",
    "write.lock*",
    "*.bak",
    ""
  ].join("\n");
}

export async function ensureStateGitignore(projectRoot: string): Promise<void> {
  const path = join(projectRoot, STATE_FILES.gitignore);
  try {
    await access(path);
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, defaultKoanGitignore(), "utf8");
  }
}
