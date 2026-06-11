import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { UserProfileRefSchema, type UserProfileRef } from "./schemas.js";
import { withFileLock } from "./lock.js";
import { getProfilePath } from "./profile.js";

export async function loadProfileRef(projectRoot: string): Promise<UserProfileRef | null> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.userProfileRef), "utf8");
    return UserProfileRefSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function ensureProfileRef(projectRoot: string, homeDir: string): Promise<UserProfileRef> {
  const existing = await loadProfileRef(projectRoot);
  if (existing) return existing;

  const ref: UserProfileRef = { version: 1, profilePath: getProfilePath(homeDir), overrides: {} };
  const path = join(projectRoot, STATE_FILES.userProfileRef);
  await withFileLock(projectRoot, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(ref, null, 2)}\n`, "utf8");
  });
  return ref;
}
