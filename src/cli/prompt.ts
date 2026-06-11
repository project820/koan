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
  let pending: ((line: string | null) => void) | null = null;

  rl.on("line", (line) => {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(line.trim());
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => {
    closed = true;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(null);
    }
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
        pending = resolve;
      });
    },
    close(): void {
      if (!closed) rl.close();
    }
  };
}
