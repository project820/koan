import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { McpCacheSchema, type McpCache } from "./schemas.js";
import { withFileLock } from "./lock.js";

function freshMcpCache(): McpCache {
  return { version: 1, lastQuestion: null };
}

export async function loadMcpCache(projectRoot: string): Promise<McpCache> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.mcpCache), "utf8");
    return McpCacheSchema.parse(JSON.parse(raw));
  } catch {
    return freshMcpCache();
  }
}

export async function saveMcpCache(projectRoot: string, cache: McpCache): Promise<void> {
  const parsed = McpCacheSchema.parse(cache);
  const path = join(projectRoot, STATE_FILES.mcpCache);
  await withFileLock(projectRoot, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  });
}
