import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";
import { ensureStateGitignore } from "./gitPolicy.js";
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
  const path = join(projectRoot, STATE_FILES.userProfileRef);
  const ref: UserProfileRef = { version: 1, profilePath: getProfilePath(homeDir), overrides: {} };

  return withFileLock(projectRoot, async () => {
    let raw: string | null = null;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        return UserProfileRefSchema.parse(JSON.parse(raw));
      } catch {
        await writeFile(`${path}.bak`, raw, "utf8");
      }
    }
    await ensureStateGitignore(projectRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(ref, null, 2)}\n`, "utf8");
    return ref;
  });
}
