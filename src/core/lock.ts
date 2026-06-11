import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
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
  token: string | null;
}

function lockPayload(token: string): string {
  return `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token })}\n`;
}

function parseLockInfo(raw: string): LockInfo | null {
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown; token?: unknown };
    if (typeof parsed.pid !== "number" || typeof parsed.createdAt !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.createdAt))) return null;
    return {
      pid: parsed.pid,
      createdAt: parsed.createdAt,
      token: typeof parsed.token === "string" ? parsed.token : null
    };
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

async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  try {
    await writeFile(lockPath, lockPayload(token), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function reclaimStaleLock(lockPath: string): Promise<void> {
  // rename is atomic: of N processes that judged the same lock stale, only
  // the rename winner proceeds; losers fall through to the single retry.
  const reclaimPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, reclaimPath);
  } catch {
    return;
  }
  await rm(reclaimPath, { force: true });
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    return;
  }
  if (parseLockInfo(raw)?.token === token) {
    await rm(lockPath, { force: true });
  }
}

export async function withFileLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(projectRoot, STATE_FILES.lock);
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomUUID();

  if (!(await tryAcquire(lockPath, token))) {
    const { stale, holderPid } = await inspectLock(lockPath);
    if (!stale) {
      const holder = holderPid === null ? "another process" : `pid ${holderPid}`;
      throw new KoanLockError(
        `Koan write lock at ${STATE_FILES.lock} is held by ${holder}. Remove ${STATE_FILES.lock} if no Koan process is running.`
      );
    }
    await reclaimStaleLock(lockPath);
    if (!(await tryAcquire(lockPath, token))) {
      throw new KoanLockError(`Koan write lock already exists at ${STATE_FILES.lock}`);
    }
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, token);
  }
}
