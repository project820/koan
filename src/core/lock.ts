import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATE_FILES } from "./constants.js";

export const LOCK_STALE_MS = 10 * 60 * 1000;

export class KoanLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KoanLockError";
  }
}

interface LockInfo {
  pid: number;
  createdAt: string;
}

function lockPayload(): string {
  return `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`;
}

function parseLockInfo(raw: string): LockInfo | null {
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown };
    if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function inspectLock(lockPath: string): Promise<{ stale: boolean; holderPid: number | null }> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    return { stale: true, holderPid: null };
  }

  const info = parseLockInfo(raw);
  if (info) {
    const expired = Date.now() - Date.parse(info.createdAt) > LOCK_STALE_MS;
    return { stale: !isPidAlive(info.pid) || expired, holderPid: info.pid };
  }

  try {
    const stats = await stat(lockPath);
    return { stale: Date.now() - stats.mtimeMs > LOCK_STALE_MS, holderPid: null };
  } catch {
    return { stale: true, holderPid: null };
  }
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    await writeFile(lockPath, lockPayload(), { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

export async function withFileLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(projectRoot, STATE_FILES.lock);
  await mkdir(dirname(lockPath), { recursive: true });

  if (!(await tryAcquire(lockPath))) {
    const { stale, holderPid } = await inspectLock(lockPath);
    if (!stale) {
      const holder = holderPid === null ? "another process" : `pid ${holderPid}`;
      throw new KoanLockError(
        `Koan write lock at ${STATE_FILES.lock} is held by ${holder}. Remove ${STATE_FILES.lock} if no Koan process is running.`
      );
    }
    await rm(lockPath, { force: true });
    if (!(await tryAcquire(lockPath))) {
      throw new KoanLockError(`Koan write lock already exists at ${STATE_FILES.lock}`);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}
