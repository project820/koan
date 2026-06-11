import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { ensureStateGitignore } from "./gitPolicy.js";
import { McpCacheSchema, type McpCache } from "./schemas.js";
import { withFileLock } from "./lock.js";

function freshMcpCache(): McpCache {
  return { version: 1, lastQuestion: null, rawIntent: null };
}

export async function loadMcpCache(projectRoot: string): Promise<McpCache> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.mcpCache), "utf8");
    return McpCacheSchema.parse(JSON.parse(raw));
  } catch {
    return freshMcpCache();
  }
}

// Caller must hold the project write lock.
async function writeMcpCacheUnlocked(projectRoot: string, cache: McpCache): Promise<McpCache> {
  const parsed = McpCacheSchema.parse(cache);
  const path = join(projectRoot, STATE_FILES.mcpCache);
  await ensureStateGitignore(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

export async function saveMcpCache(projectRoot: string, cache: McpCache): Promise<void> {
  await withFileLock(projectRoot, async () => {
    await writeMcpCacheUnlocked(projectRoot, cache);
  });
}

// Atomic read-modify-write: load, mutate, and persist happen inside a single
// file lock so concurrent tool calls cannot interleave between read and write.
export async function updateMcpCache(
  projectRoot: string,
  mutate: (cache: McpCache) => McpCache
): Promise<McpCache> {
  return withFileLock(projectRoot, async () =>
    writeMcpCacheUnlocked(projectRoot, mutate(await loadMcpCache(projectRoot)))
  );
}
