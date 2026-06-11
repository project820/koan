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

interface LockInspection {
  stale: boolean;
  holderPid: number | null;
  raw: string | null;
}

async function inspectLock(lockPath: string): Promise<LockInspection> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    return { stale: true, holderPid: null, raw: null };
  }

  const info = parseLockInfo(raw);
  if (info) {
    const expired = Date.now() - Date.parse(info.createdAt) > LOCK_STALE_MS;
    return { stale: !isPidAlive(info.pid) || expired, holderPid: info.pid, raw };
  }

  try {
    const stats = await stat(lockPath);
    return { stale: Date.now() - stats.mtimeMs > LOCK_STALE_MS, holderPid: null, raw };
  } catch {
    return { stale: true, holderPid: null, raw };
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

async function reclaimStaleLock(lockPath: string, expectedRaw: string | null): Promise<void> {
  // rename is atomic: of N processes that judged the same lock stale, only
  // the rename winner proceeds; losers fall through to the single retry.
  const reclaimPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, reclaimPath);
  } catch {
    return;
  }

  let reclaimedRaw: string | null = null;
  try {
    reclaimedRaw = await readFile(reclaimPath, "utf8");
  } catch {
    reclaimedRaw = null;
  }
  if (reclaimedRaw !== null && reclaimedRaw !== expectedRaw) {
    // The lock changed between inspection and rename: a fresh holder was
    // displaced. Restore it; if restore loses a race to a newer acquirer,
    // the displaced holder's release is token-checked and harmless.
    try {
      await rename(reclaimPath, lockPath);
      return;
    } catch {
      // fall through to remove the displaced copy
    }
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

// Advisory single-writer lock (spec §6.4): stop-on-conflict guidance for a
// one-writer-at-a-time model, not contention-grade mutual exclusion. Without
// OS-level flock a microsecond window remains between staleness inspection
// and reclaim/release; reclaim verifies the displaced payload and restores
// fresh locks, and release only removes a lock holding its own token.
export async function withFileLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(projectRoot, STATE_FILES.lock);
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomUUID();

  if (!(await tryAcquire(lockPath, token))) {
    const inspection = await inspectLock(lockPath);
    if (!inspection.stale) {
      const holder = inspection.holderPid === null ? "another process" : `pid ${inspection.holderPid}`;
      throw new KoanLockError(
        `Koan write lock at ${STATE_FILES.lock} is held by ${holder}. Remove ${STATE_FILES.lock} if no Koan process is running.`
      );
    }
    await reclaimStaleLock(lockPath, inspection.raw);
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
