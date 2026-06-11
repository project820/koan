import { createInterface } from "node:readline";

export interface Prompter {
  ask(question: string): Promise<string | null>;
  close(): void;
}

// Lines are buffered as they arrive so piped stdin that delivers several
// lines in one chunk (or closes early) never loses input between asks.
export function createPrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): Prompter {
  const rl = createInterface({ input, output });
  const lines: string[] = [];
  let closed = false;
  // FIFO queue so concurrent asks each get their own line instead of a later
  // ask overwriting an earlier resolver (which would leave it forever pending).
  const pending: Array<(line: string | null) => void> = [];

  rl.on("line", (line) => {
    const resolve = pending.shift();
    if (resolve) {
      resolve(line.trim());
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => {
    closed = true;
    const waiting = pending.splice(0, pending.length);
    for (const resolve of waiting) resolve(null);
  });

  return {
    ask(question: string): Promise<string | null> {
      const buffered = lines.shift();
      if (buffered !== undefined) {
        output.write(question);
        return Promise.resolve(buffered.trim());
      }
      if (closed) {
        output.write(question);
        return Promise.resolve(null);
      }
      rl.setPrompt(question);
      rl.prompt();
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    },
    close(): void {
      if (!closed) rl.close();
    }
  };
}
