import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { KoanLockError, LOCK_STALE_MS, withFileLock } from "../src/core/lock.js";
import { withTempProject } from "./helpers/fs.js";

async function writeLockFile(root: string, pid: number, createdAt: string): Promise<string> {
  const lockPath = join(root, ".koan/write.lock");
  await mkdir(join(root, ".koan"), { recursive: true });
  await writeFile(lockPath, `${JSON.stringify({ pid, createdAt })}\n`, "utf8");
  return lockPath;
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await once(child, "exit");
  if (typeof pid !== "number") throw new Error("failed to spawn probe process");
  return pid;
}

describe("write lock", () => {
  it("reclaims a lock held by a dead process", async () => {
    await withTempProject(async (root) => {
      const lockPath = await writeLockFile(root, await exitedPid(), new Date().toISOString());
      const result = await withFileLock(root, async () => "ran");
      expect(result).toBe("ran");
      await expect(access(lockPath)).rejects.toThrow();
    });
  });

  it("reclaims a live-pid lock older than LOCK_STALE_MS", async () => {
    await withTempProject(async (root) => {
      const createdAt = new Date(Date.now() - LOCK_STALE_MS - 1000).toISOString();
      await writeLockFile(root, process.pid, createdAt);
      const result = await withFileLock(root, async () => "ran");
      expect(result).toBe("ran");
    });
  });

  it("refuses a fresh lock held by a live process", async () => {
    await withTempProject(async (root) => {
      const lockPath = await writeLockFile(root, process.pid, new Date().toISOString());
      let error: unknown;
      try {
        await withFileLock(root, async () => undefined);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(KoanLockError);
      expect((error as Error).message).toContain(`pid ${process.pid}`);
      expect((error as Error).message).toContain(".koan/write.lock");
      await expect(access(lockPath)).resolves.toBeUndefined();
    });
  });

  it("throws when withFileLock is nested", async () => {
    await withTempProject(async (root) => {
      await withFileLock(root, async () => {
        await expect(withFileLock(root, async () => undefined)).rejects.toThrow(KoanLockError);
      });
    });
  });
});
