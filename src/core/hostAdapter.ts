// Host adapters tune how Koan speaks to the host agent, not what it says:
// every variant must carry the same contract (preserve user reasoning,
// structured answer recording, philosophy-aware QA, no invented requirements)
// in the phrasing that works best for that model family. The variants are
// static strings — no network, no model calls. See docs/host-adapters.md for
// the vendor-guide rationale behind each variant.

export type HostId = "claude" | "codex" | "generic";

export interface HostAdapter {
  questionInstruction: string;
  qaPrompt: string;
  prdSynthesisInstruction: string;
}

export function detectHost(clientName?: string): HostId {
  const name = clientName?.toLowerCase() ?? "";
  if (name.includes("claude")) return "claude";
  if (name.includes("codex") || name.includes("openai") || name.includes("gpt")) return "codex";
  return "generic";
}

const adapters: Record<HostId, HostAdapter> = {
  generic: {
    questionInstruction:
      "Preserve the user's reasoning. If using MCP mode, structure the answer into decision, reasoning, constraints, out-of-scope, and project context before recording it. If the answer reveals that the real product differs from the surface request, record that realization with koan_record_insight.",
    qaPrompt:
      "Compare the implementation summary against Koan documents, including `koan/philosophy.md` when it exists. Separate Koan-spec compliance issues, philosophy-alignment issues, and general quality issues.",
    prdSynthesisInstruction:
      "Synthesize this section from the recorded answers and `koan/philosophy.md` only; do not invent requirements the user never stated. Write the result with koan_synthesize_prd."
  },
  claude: {
    questionInstruction:
      "Preserve the user's exact reasoning — quote their key phrases instead of paraphrasing them away. Before recording, structure the answer as: decision, reasoning, constraints, out-of-scope, and project context. Consider what the answer implies before scoring clarity. If the answer reveals that the real product differs from the surface request, record that realization with koan_record_insight before asking the next question.",
    qaPrompt:
      "Review the implementation against the Koan documents, reading `koan/philosophy.md` first when it exists. Report findings in three separate groups — Koan-spec compliance issues, philosophy-alignment issues, and general quality issues — and cite the document passage each finding violates.",
    prdSynthesisInstruction:
      "Synthesize this section strictly from the recorded answers and `koan/philosophy.md`: ground every sentence in something the user actually said and prefer their own wording. Do not invent requirements the user never stated. Write the result with koan_synthesize_prd."
  },
  codex: {
    questionInstruction:
      "Preserve the user's reasoning verbatim where possible. Record the answer structured as: decision; reasoning; constraints; out-of-scope; project context. Score clarity conservatively. If the answer reveals that the real product differs from the surface request, call koan_record_insight with that realization.",
    qaPrompt:
      "Compare the implementation against Koan documents; read `koan/philosophy.md` first when it exists. Output three lists: Koan-spec compliance issues; philosophy-alignment issues; general quality issues. Review only — do not fix.",
    prdSynthesisInstruction:
      "Synthesize from the recorded answers and `koan/philosophy.md` only. Do not invent requirements the user never stated. Keep the user's wording. Write the result with koan_synthesize_prd."
  }
};

export function adapterFor(host: HostId): HostAdapter {
  return adapters[host];
}
