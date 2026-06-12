export interface HandoffDocumentInput {
  summary: string;
  experimentalHandoff: boolean;
}

export function buildHandoffDocument(input: HandoffDocumentInput): string {
  const experimentalStatus = input.experimentalHandoff
    ? "MVP status: extension flag enabled, but no touchless adapter is implemented."
    : "MVP status: disabled. This handoff is document-based.";

  return [
    "# Handoff",
    "",
    "Read `koan/philosophy.md` first when it exists. Keep the continuation",
    "aligned with the product philosophy, not just the remaining task list.",
    "",
    "## Current Summary",
    "",
    input.summary,
    "",
    "## Experimental Touchless Handoff",
    "",
    experimentalStatus,
    ""
  ].join("\n");
}
