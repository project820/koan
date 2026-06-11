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
