# Koan

Koan is project-local memory for agentic coding work. It helps Codex, Claude,
and MCP-capable agents converge vague intent into readable project documents:
goals, plans, status, QA criteria, bright ideas, and handoff notes.

Koan is MCP-first, but not LLM-provider-first. It never calls an LLM API and
never transmits project data over the network. The core tool is deterministic;
host agents provide semantic reasoning through MCP.

## Install

Requires Node.js 20+.

```bash
npm install -g @m5max/koan
```

## CLI

The CLI works standalone with deterministic question templates; no host agent
or API key is required.

- `koan hello` — initialize or resume a session; runs the question loop on a
  TTY (force it with `--interactive`).
- `koan hello --setup` — guided profile setup.
- `koan hello --profile` — print the global profile (read-only).
- `koan hello --reset-profile [--yes]` — delete the global profile (`--yes`
  skips confirmation).
- `koan status` — show goal, status, and next action without writing.
- `koan status --update <text>` — record a status update.
- `koan status --archive` — archive the active goal to `koan/archive/<goal-id>/`.
- `koan answer <axis> <text>` — record an answer for one ambiguity axis.
- `koan enough` — accept current clarity and stop questioning.
- `koan crystallize [--dry-run]` — write recorded answers into documents;
  `--dry-run` previews the write plan.
- `koan bright-idea [--classify <type>] <text>` — record an idea without
  changing the plan; types: `clarify`, `change-goal`, `later-follow-up`, `reject`.
- `koan qa` — create or refresh the QA checklist.
- `koan handoff <summary>` — create a document-based handoff.

## MCP Server

Run `koan-mcp` (stdio transport) and register it with your MCP-capable agent.
From a checkout, `npm run mcp` starts the same server.

| Tool | Purpose |
| ---- | ------- |
| `koan_get_profile` | Read the global profile, learning mode, and per-project overrides. |
| `koan_update_profile` | Apply a partial profile update; reports changed fields. |
| `koan_inspect_project` | Report Koan state, bootstrap markers, document paths, and git policy. |
| `koan_start_session` | Initialize or resume a session; optionally captures raw intent. |
| `koan_get_next_question` | Return the question for the most unclear axis and cache it. |
| `koan_record_answer` | Record an answer (axis from input or the cached question) with optional host interpretation; returns a crystallize preview. |
| `koan_crystallize_documents` | Write recorded answers into managed document regions (`dryRun` supported). |
| `koan_get_status` | Summarize goal, status, next action, and stale-state warnings. |
| `koan_update_status` | Write a status update into `koan/status.md` and the handoff document. |
| `koan_record_bright_idea` | Record a classified idea plus a deterministic recommendation. |
| `koan_prepare_qa` | Generate `koan/qa.md` with spec-compliance and quality checks. |
| `koan_prepare_handoff` | Generate `koan/handoff.md`; touchless handoff stays disabled. |

All tool results are JSON in the first text content block; inputs are
zod-validated and failures surface as MCP errors.

Koan uses a semantic-host model: the core stays deterministic (state, scoring,
managed document writes) while the host agent supplies interpretation —
rephrasing questions, structuring answers, and scoring clarity through
`interpretation.clarity` on `koan_record_answer`. Without a host, the CLI runs
the same flow with built-in templates.

## Project Files

Human-facing memory lives in `koan/`; machine state lives in `.koan/`.

- Core documents (always created): `koan/README.md`, `koan/goal.md`,
  `koan/status.md`, `koan/plan.md`.
- Lazy documents (created on first use): `koan/philosophy.md`,
  `koan/decisions.md`, `koan/open-questions.md`, `koan/qa.md`,
  `koan/handoff.md`, `koan/bright-ideas.md`.
- State: `.koan/project.json` is intended to be committed; session state, the
  ambiguity ledger, command log, MCP cache, and lock files are ignored through
  a generated `.koan/.gitignore`.

Koan only rewrites its own managed regions (`<!-- koan:section:start ... -->`);
manual edits outside the markers are preserved.

## Question Model

Koan tracks clarity across 11 ambiguity axes: `purpose`, `target_users`,
`current_goal`, `scope`, `non_goals`, `constraints`, `success_criteria`,
`philosophical_intent`, `implementation_plan`, `qa_criteria`, and
`handoff_readiness`.

Question phrasing adapts to the user profile: language (`ko`, `en`, `mixed`)
crossed with four development-understanding levels. A goal converges when every
axis reaches the convergence threshold (default `0.7`), configurable as
`settings.convergenceThreshold` in `.koan/project.json`.

## Privacy

Koan has no telemetry and does not transmit profile, project, or answer data
over the network. The global user profile is stored at `~/.koan/profile.json`.
Profile inference is allowlist-only: hosts may propose updates to the declared
profile fields and nothing else, and the default `approval_required` learning
mode keeps changes user-approved.
