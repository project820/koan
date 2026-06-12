import { watch, type FSWatcher } from "node:fs";
import { basename, join } from "node:path";
import { KOAN_DIR, KOAN_STATE_DIR } from "../core/constants.js";
import { collectDashboardSnapshot, type DashboardSnapshot } from "../core/dashboard.js";
import { findProjectRoot } from "../core/project.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

const BAR_CELLS = 10;

const LABELS = {
  en: {
    next: "Next",
    goal: "Goal",
    status: "Status",
    insights: "Insights",
    threshold: "threshold",
    unresolved: "unresolved",
    noSession: "no session — run koan hello",
    converged: "converged — ready to crystallize and archive",
    quit: "q quit",
    live: "live",
    last: "last"
  },
  ko: {
    next: "다음 질문",
    goal: "목표",
    status: "상태",
    insights: "인사이트",
    threshold: "임계",
    unresolved: "축 미해결",
    noSession: "세션 없음 — koan hello를 실행하세요",
    converged: "수렴 완료 — crystallize 후 archive 가능",
    quit: "q 종료",
    live: "실시간",
    last: "최근"
  }
} as const;

// CJK codepoints occupy two terminal columns; everything else is treated as
// one. Close enough for truncation — exact wcwidth is not worth a dependency.
const WIDE_CHAR = new RegExp(
  "[\\u1100-\\u115F\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]"
);

function charWidth(char: string): number {
  return WIDE_CHAR.test(char) ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

export function truncateToWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) return text;
  let width = 0;
  let out = "";
  for (const char of text) {
    const next = width + charWidth(char);
    if (next > maxWidth - 1) break;
    out += char;
    width = next;
  }
  return `${out}…`;
}

export interface RenderOptions {
  width: number;
  color: boolean;
  live: boolean;
}

export function renderDashboard(snapshot: DashboardSnapshot, options: RenderOptions): string {
  const width = Math.max(40, options.width);
  const paint = (text: string, code: string): string => (options.color ? `${code}${text}${RESET}` : text);
  const labels = LABELS[snapshot.profileLanguage === "ko" ? "ko" : "en"];
  const lines: string[] = [];

  const title = `Koan — ${basename(snapshot.projectRoot)}`;
  const session =
    snapshot.goalId === null ? labels.noSession : `goal ${snapshot.goalId} · ${snapshot.phase}`;
  const gap = width - displayWidth(title) - displayWidth(session);
  lines.push(
    gap >= 2
      ? `${paint(title, BOLD)}${" ".repeat(gap)}${paint(session, DIM)}`
      : truncateToWidth(`${title} · ${session}`, width)
  );
  lines.push("─".repeat(width));

  const axisColumn = Math.max(...snapshot.axes.map((entry) => entry.axis.length));
  for (const entry of snapshot.axes) {
    const filled = Math.round(entry.clarity * BAR_CELLS);
    const bar = "█".repeat(filled) + "░".repeat(BAR_CELLS - filled);
    const barColor = entry.clarity >= snapshot.threshold ? GREEN : entry.clarity > 0 ? YELLOW : DIM;
    const marker = snapshot.nextQuestion?.axis === entry.axis ? "  ← next" : "";
    lines.push(
      `${entry.axis.padEnd(axisColumn)} ${paint(bar, barColor)} ${entry.clarity.toFixed(1)}${paint(marker, DIM)}`
    );
  }
  lines.push(
    paint(
      snapshot.converged
        ? labels.converged
        : `${labels.threshold} ${snapshot.threshold} · ${snapshot.unresolvedCount} ${labels.unresolved}`,
      DIM
    )
  );
  lines.push("─".repeat(width));

  if (snapshot.nextQuestion) {
    lines.push(truncateToWidth(`${labels.next}: ${snapshot.nextQuestion.userFacingQuestion}`, width));
  }
  if (snapshot.activeGoal) {
    lines.push(truncateToWidth(`${labels.goal}: ${snapshot.activeGoal.split("\n")[0]}`, width));
  }
  if (snapshot.latestStatus) {
    lines.push(truncateToWidth(`${labels.status}: ${snapshot.latestStatus.split("\n")[0]}`, width));
  }
  if (snapshot.insights.length > 0) {
    const recent = snapshot.insights.slice(-2).join(" · ");
    lines.push(truncateToWidth(`${labels.insights}(${snapshot.insights.length}): ${recent}`, width));
  }
  for (const warning of snapshot.staleWarnings) {
    lines.push(paint(truncateToWidth(`⚠ ${warning}`, width), YELLOW));
  }
  lines.push(truncateToWidth(`→ ${snapshot.nextAction}`, width));

  const footerParts: string[] = [];
  if (options.live) footerParts.push(labels.quit, labels.live);
  if (snapshot.lastCommand) {
    footerParts.push(`${labels.last}: ${snapshot.lastCommand.command} (${snapshot.lastCommand.at})`);
  }
  if (footerParts.length > 0) {
    lines.push(paint(truncateToWidth(footerParts.join(" · "), width), DIM));
  }

  return lines.join("\n");
}

export interface RunDashboardInput {
  cwd: string;
  homeDir: string;
  once?: boolean;
}

export async function runDashboard(input: RunDashboardInput): Promise<number> {
  const live =
    input.once !== true && process.stdout.isTTY === true && process.stdin.isTTY === true;
  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;

  const render = async (): Promise<string> => {
    const snapshot = await collectDashboardSnapshot({ cwd: input.cwd, homeDir: input.homeDir });
    return renderDashboard(snapshot, { width: process.stdout.columns ?? 80, color, live });
  };

  if (!live) {
    console.log(await render());
    return 0;
  }

  const projectRoot = await findProjectRoot(input.cwd);
  const watchers: FSWatcher[] = [];
  let redrawTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let finished = false;

  const draw = async (): Promise<void> => {
    const frame = await render().catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    if (!finished) process.stdout.write(`\x1b[H\x1b[2J${frame}\n`);
  };

  const scheduleDraw = (): void => {
    if (redrawTimer) clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => void draw(), 150);
  };

  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      if (redrawTimer) clearTimeout(redrawTimer);
      if (pollTimer) clearInterval(pollTimer);
      for (const watcher of watchers) watcher.close();
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.removeListener("resize", scheduleDraw);
      process.stdout.write("\x1b[?1049l\x1b[?25h");
      resolve(0);
    };

    process.stdout.write("\x1b[?1049h\x1b[?25l");

    for (const dir of [join(projectRoot, KOAN_STATE_DIR), join(projectRoot, KOAN_DIR)]) {
      try {
        watchers.push(watch(dir, scheduleDraw));
      } catch {
        // Directory may not exist yet (bare project); the poll timer covers it.
      }
    }
    pollTimer = setInterval(() => void draw(), 5000);
    process.stdout.on("resize", scheduleDraw);

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (chunk: Buffer) => {
      const key = chunk.toString("utf8");
      if (key === "q" || key === "Q" || key === "\x03") cleanup();
    });
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    void draw();
  });
}
