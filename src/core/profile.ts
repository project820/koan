import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UserProfileSchema, type Language, type UserProfile } from "./schemas.js";

export function getProfilePath(homeDir: string): string {
  return join(homeDir, ".koan/profile.json");
}

export function defaultProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    developmentUnderstanding: "beginner",
    explanationStyle: "example_first",
    language: "ko",
    outputUse: "agent_execution",
    domainBackground: "",
    learningMode: "approval_required",
    ...overrides
  };
}

export async function loadProfile(homeDir: string): Promise<UserProfile | null> {
  try {
    const raw = await readFile(getProfilePath(homeDir), "utf8");
    return UserProfileSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveProfile(homeDir: string, profile: UserProfile): Promise<UserProfile> {
  const parsed = UserProfileSchema.parse(profile);
  const path = getProfilePath(homeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

export async function resetProfile(homeDir: string): Promise<void> {
  await rm(getProfilePath(homeDir), { force: true });
}

export function normalizeLanguage(value: string): Language {
  if (value === "en" || value === "mixed") return value;
  return "ko";
}
