# Host Adapters

Koan speaks to host agents in four places: the `hostAgentInstruction` attached
to every question, the "MCP Host Agent Prompt" section of `koan/qa.md`, the
pending-synthesis placeholders in `koan/prd.md`, and the MCP tool
descriptions. The host adapter layer (`src/core/hostAdapter.ts`) varies the
phrasing of the first three per connected model family, because frontier
models respond measurably better to instructions written in the style their
vendor's prompting guide recommends.

## Principles

1. **Same contract, different dialect.** Every variant must carry the same
   obligations — preserve the user's reasoning, structure recorded answers
   (decision / reasoning / constraints / out-of-scope / project context),
   review philosophy alignment separately in QA, never invent requirements in
   PRD synthesis, and record realizations via `koan_record_insight`. If a
   variant dropped one of these, hosts would converge differently and
   cross-agent symmetry would break. `test/hostAdapter.test.ts` pins the
   shared semantics as required tokens per variant.
2. **Deterministic and local.** Adapters are static strings selected from the
   `clientInfo.name` the MCP client sends in the `initialize` handshake
   (`server.getClientVersion()`). No network, no model calls, no telemetry.
   Unknown clients and the standalone CLI use the `generic` variant.

## Host detection

| `clientInfo.name` contains | Adapter |
| -------------------------- | ------- |
| `claude` | `claude` |
| `codex`, `openai`, `gpt` | `codex` |
| anything else / absent | `generic` |

## Variant rationale

- **claude** — Anthropic's prompting guidance favors explicit structure,
  grounding in quoted source material, and considering implications before
  concluding. The variant asks the host to quote the user's key phrases,
  structure before recording, and weigh implications before scoring clarity;
  the QA variant asks for findings grouped with cited document passages.
- **codex** — OpenAI's Codex/GPT prompting guidance favors terse imperative
  instructions with explicit output shapes and tight scope ("review only — do
  not fix"). The variant uses semicolon-delimited structure lists and
  explicit output lists in QA.
- **generic** — neutral phrasing, safe for any MCP client; identical in
  meaning to the other two.

Vendor guides evolve. When updating a variant, change the phrasing freely but
keep the required-token tests green — they are the semantic floor, not a
style constraint.
