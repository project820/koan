import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  BOOTSTRAP_END,
  BOOTSTRAP_START,
  CORE_DOCUMENTS,
  KOAN_DIR,
  KOAN_STATE_DIR,
  KOAN_VERSION,
  STATE_FILES
} from "./constants.js";
import { defaultKoanGitignore } from "./gitPolicy.js";
import { withFileLock } from "./lock.js";
import { DEFAULT_CONVERGENCE_THRESHOLD, ProjectConfigSchema, type ProjectConfig } from "./schemas.js";

export interface ProjectInspection {
  projectRoot: string;
  isKoanProject: boolean;
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  hasKoanBootstrap: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    if (
      (await exists(join(current, "package.json"))) ||
      (await exists(join(current, ".git"))) ||
      (await exists(join(current, KOAN_DIR)))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export async function inspectProject(start: string): Promise<ProjectInspection> {
  const projectRoot = await findProjectRoot(start);
  const agentsPath = join(projectRoot, "AGENTS.md");
  const claudePath = join(projectRoot, "CLAUDE.md");
  const hasAgentsMd = await exists(agentsPath);
  const hasClaudeMd = await exists(claudePath);
  const isKoanProject = await exists(join(projectRoot, STATE_FILES.project));
  const bootstrapTargets = [agentsPath, claudePath];
  let hasKoanBootstrap = false;

  for (const target of bootstrapTargets) {
    if (await exists(target)) {
      const text = await readFile(target, "utf8");
      hasKoanBootstrap = hasKoanBootstrap || text.includes(BOOTSTRAP_START);
    }
  }

  return { projectRoot, isKoanProject, hasAgentsMd, hasClaudeMd, hasKoanBootstrap };
}

function bootstrapBlock(): string {
  return [
    BOOTSTRAP_START,
    "Before working in this project, read:",
    "1. koan/philosophy.md if it exists — the product philosophy behind every goal",
    "2. koan/goal.md",
    "3. koan/status.md",
    "4. koan/plan.md",
    "5. koan/handoff.md if continuing prior work",
    "",
    "Stay aligned with Koan documents. If the requested work changes scope,",
    "introduces a new direction, or conflicts with the product philosophy,",
    "record it through `koan bright-idea` and ask the user to run a Koan",
    "clarification loop instead of silently expanding scope.",
    "",
    "For review work, also read koan/qa.md when it exists.",
    BOOTSTRAP_END,
    ""
  ].join("\n");
}

export function patchBootstrap(existing: string): string {
  const block = bootstrapBlock();
  const start = existing.indexOf(BOOTSTRAP_START);
  const end = existing.indexOf(BOOTSTRAP_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + BOOTSTRAP_END.length).replace(/^\n?/, "")}`;
  }
  return existing.trimEnd().length > 0 ? `${existing.trimEnd()}\n\n${block}` : block;
}

async function ensureFile(path: string, content: string): Promise<void> {
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

async function patchFile(path: string): Promise<void> {
  const current = (await exists(path)) ? await readFile(path, "utf8") : "";
  const next = patchBootstrap(current);
  if (next !== current) await writeFile(path, next, "utf8");
}

export const DEFAULT_ACTIVE_GOAL_PLACEHOLDER = "No active goal yet.";
export const DEFAULT_PLAN_PLACEHOLDER = "No implementation plan recorded yet.";
export const DEFAULT_STATUS_PLACEHOLDER = "No status recorded yet.";

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig | null> {
  try {
    const raw = await readFile(join(projectRoot, STATE_FILES.project), "utf8");
    return ProjectConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function ensureKoanProject(start: string): Promise<ProjectConfig> {
  const projectRoot = await findProjectRoot(start);
  return withFileLock(projectRoot, async () => {
    await mkdir(join(projectRoot, KOAN_DIR), { recursive: true });
    await mkdir(join(projectRoot, KOAN_STATE_DIR), { recursive: true });

    await ensureFile(join(projectRoot, CORE_DOCUMENTS.readme), "# Koan Project Memory\n\nRead `philosophy.md` first when it exists, then `goal.md`, `status.md`, and `plan.md`.\n");
    await ensureFile(join(projectRoot, CORE_DOCUMENTS.goal), `# Goal\n\nThe active goal serves the product philosophy in \`philosophy.md\` when it exists.\n\n## Active Goal\n\n<!-- koan:section:start name="active-goal" -->\n${DEFAULT_ACTIVE_GOAL_PLACEHOLDER}\n<!-- koan:section:end name="active-goal" -->\n`);
    await ensureFile(join(projectRoot, CORE_DOCUMENTS.status), `# Status\n\n<!-- koan:section:start name="current-status" -->\n${DEFAULT_STATUS_PLACEHOLDER}\n<!-- koan:section:end name="current-status" -->\n`);
    await ensureFile(join(projectRoot, CORE_DOCUMENTS.plan), `# Plan\n\nImplementation must preserve the product philosophy in \`philosophy.md\` when it exists.\n\n<!-- koan:section:start name="implementation-plan" -->\n${DEFAULT_PLAN_PLACEHOLDER}\n<!-- koan:section:end name="implementation-plan" -->\n`);
    await ensureFile(join(projectRoot, STATE_FILES.gitignore), defaultKoanGitignore());

    await patchFile(join(projectRoot, "AGENTS.md"));
    await patchFile(join(projectRoot, "CLAUDE.md"));

    const existing = await loadProjectConfig(projectRoot);
    const config: ProjectConfig = {
      version: 1,
      koanVersion: KOAN_VERSION,
      projectRoot,
      strictness: existing?.strictness ?? "advisory",
      experimentalHandoff: existing?.experimentalHandoff ?? false,
      documents: CORE_DOCUMENTS,
      settings: existing?.settings ?? { convergenceThreshold: DEFAULT_CONVERGENCE_THRESHOLD }
    };
    await writeFile(join(projectRoot, STATE_FILES.project), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  });
}
