import { access, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { KoanLockError, LOCK_STALE_MS, withFileLock } from "../src/core/lock.js";
import { archiveGoal } from "../src/core/session.js";
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

  it("refuses a fresh unparseable lock", async () => {
    await withTempProject(async (root) => {
      const lockPath = join(root, ".koan/write.lock");
      await mkdir(join(root, ".koan"), { recursive: true });
      await writeFile(lockPath, "not json", "utf8");
      await expect(withFileLock(root, async () => undefined)).rejects.toThrow(KoanLockError);
      await expect(access(lockPath)).resolves.toBeUndefined();
    });
  });

  it("reclaims an unparseable lock older than LOCK_STALE_MS", async () => {
    await withTempProject(async (root) => {
      const lockPath = join(root, ".koan/write.lock");
      await mkdir(join(root, ".koan"), { recursive: true });
      await writeFile(lockPath, "not json", "utf8");
      const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
      await utimes(lockPath, old, old);
      const result = await withFileLock(root, async () => "ran");
      expect(result).toBe("ran");
    });
  });

  it("releases the lock when fn throws", async () => {
    await withTempProject(async (root) => {
      await expect(
        withFileLock(root, async () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");
      const result = await withFileLock(root, async () => "ran");
      expect(result).toBe("ran");
    });
  });

  it("does not delete a lock it no longer owns", async () => {
    await withTempProject(async (root) => {
      const lockPath = join(root, ".koan/write.lock");
      const foreign = `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: "foreign-token"
      })}\n`;
      await withFileLock(root, async () => {
        await writeFile(lockPath, foreign, "utf8");
      });
      expect(await readFile(lockPath, "utf8")).toBe(foreign);
    });
  });

  it("fails fast when archiveGoal runs under a held lock", async () => {
    await withTempProject(async (root) => {
      await writeLockFile(root, process.pid, new Date().toISOString());
      await expect(archiveGoal(root, "goal-x")).rejects.toThrow(KoanLockError);
    });
  });
});
