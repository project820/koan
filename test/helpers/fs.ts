import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function withTempProject<T>(
  fn: (root: string) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "koan-test-"));
  try {
    await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
