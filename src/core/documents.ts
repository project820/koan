import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendCommandLogInLock, type CommandLogInput } from "./commandLog.js";
import { managedEnd, managedStart } from "./constants.js";
import { type WritePlan } from "./schemas.js";
import { withFileLock } from "./lock.js";

export interface WritePlanOptions {
  log?: CommandLogInput;
}

async function readExisting(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export function replaceManagedRegion(input: string, name: string, content: string): string {
  const startMarker = managedStart(name);
  const endMarker = managedEnd(name);
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker);
  const block = `${startMarker}\n${content.trimEnd()}\n${endMarker}`;

  if (start >= 0 && end > start) {
    return `${input.slice(0, start)}${block}${input.slice(end + endMarker.length)}`;
  }

  const prefix = input.trimEnd().length > 0 ? `${input.trimEnd()}\n\n` : "";
  return `${prefix}${block}\n`;
}

export function readManagedSection(text: string, name: string): string | null {
  const startMarker = managedStart(name);
  const endMarker = managedEnd(name);
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start) return null;
  return text.slice(start + startMarker.length, end).trim();
}

export function appendLogEntry(input: string, source: string, content: string, isoDate = new Date().toISOString()): string {
  const entry = [`## ${isoDate} — ${source}`, "", content.trimEnd(), ""].join("\n");
  return `${input.trimEnd()}\n\n${entry}`;
}

export function buildManagedRegion(name: string, content: string): string {
  return `${managedStart(name)}\n${content.trimEnd()}\n${managedEnd(name)}`;
}

export function sanitizeRegionContent(text: string): string {
  return text.replaceAll("<!-- koan:", "<!- koan:");
}

export async function executeWritePlan(
  projectRoot: string,
  plan: WritePlan,
  options: WritePlanOptions = {}
): Promise<void> {
  await withFileLock(projectRoot, async () => {
    for (const operation of plan.operations) {
      const absolute = join(projectRoot, operation.path);
      await mkdir(dirname(absolute), { recursive: true });

      if (operation.type === "write") {
        await writeFile(absolute, operation.content, "utf8");
      }

      if (operation.type === "append") {
        const current = await readExisting(absolute);
        const base = current.trimEnd();
        const prefix =
          base.length > 0
            ? `${base}\n\n`
            : operation.headerIfMissing
              ? `${operation.headerIfMissing.trimEnd()}\n\n`
              : "";
        await writeFile(absolute, `${prefix}${operation.content.trimEnd()}\n`, "utf8");
      }

      if (operation.type === "managed-region") {
        const current = await readExisting(absolute);
        await writeFile(absolute, replaceManagedRegion(current, operation.name, operation.content), "utf8");
      }
    }

    if (options.log) {
      await appendCommandLogInLock(projectRoot, options.log);
    }
  });
}
