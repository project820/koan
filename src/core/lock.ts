import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { STATE_FILES } from "./constants.js";

export class KoanLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KoanLockError";
  }
}

export async function withFileLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(projectRoot, STATE_FILES.lock);
  await mkdir(dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${randomUUID()}`;

  try {
    await writeFile(lockPath, token, { encoding: "utf8", flag: "wx" });
  } catch {
    throw new KoanLockError(`Koan write lock already exists at ${STATE_FILES.lock}`);
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}
