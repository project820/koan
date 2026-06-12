# Koan

[![npm](https://img.shields.io/npm/v/%40koan-labs%2Fkoan)](https://www.npmjs.com/package/@koan-labs/koan)
[![CI](https://github.com/project820/koan/actions/workflows/ci.yml/badge.svg)](https://github.com/project820/koan/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Koan is a local-first philosophical PRD tool. It helps you clarify why a
product should exist — before asking humans or AI agents to build it — and
crystallizes that intent into readable project documents: philosophy, goals,
plans, status, QA criteria, bright ideas, and handoff notes.

Named after the Zen practice, Koan asks one reflective question at a time,
starting from purpose and philosophy rather than feature lists. The result is
durable project memory that people can read and that AI agents — Codex,
Claude, and any MCP-capable agent — can consume to build faithfully without
losing your intent.

Koan is MCP-first, but not LLM-provider-first. It never calls an LLM API and
never transmits project data over the network. The core tool is deterministic;
host agents provide semantic reasoning through MCP.

## Install

Requires Node.js 20+.

```bash
npm install -g @koan-labs/koan
```

## CLI

The CLI works standalone with deterministic question templates; no host agent
or API key is required.

- `koan hello` — initialize or resume a session; runs the question loop on a
  TTY (force it with `--interactive`). The first run is a guided journey:
  a short welcome, profile questions in your language, an optional skill
  install for Claude Code/Codex, and an open invitation to describe what's
  on your mind before the first question.
- `koan hello --setup` — guided profile setup.
- `koan hello --profile` — print the global profile (read-only).
- `koan hello --reset-profile [--yes]` — delete the global profile (`--yes`
  skips confirmation).
- `koan status` — show goal, status, and next action without writing.
- `koan dashboard [--once]` — live read-only view of per-axis clarity, the
  next question, insights, and warnings; refreshes as project files change
  (`q` to quit, `--once` or a pipe prints a single frame).
- `koan status --update <text>` — record a status update.
- `koan status --archive` — archive the active goal to `koan/archive/<goal-id>/`.
- `koan answer <axis> <text>` — record an answer for one ambiguity axis.
- `koan enough` — accept current clarity and stop questioning.
- `koan crystallize [--dry-run]` — write recorded answers into documents;
  `--dry-run` previews the write plan.
- `koan bright-idea [--classify <type>] <text>` — record an idea without
  changing the plan; types: `clarify`, `change-goal`, `later-follow-up`, `reject`.
- `koan insight <text>` — append a product realization (the moment the real
  product turns out to differ from the surface request) to `koan/philosophy.md`.
- `koan prd [--dry-run]` — synthesize `koan/prd.md` from recorded answers,
  philosophy first.
- `koan qa` — create or refresh the QA checklist.
- `koan handoff <summary>` — create a document-based handoff.
- `koan connect [--print] <claude|codex|both>` — install the `/koan` skill
  for Claude Code or Codex and register the MCP server (see Agent Skills).

## MCP Server

Run `koan-mcp` (stdio transport) and register it with your MCP-capable agent.
From a checkout, `npm run mcp` starts the same server.

| Tool | Purpose |
| ---- | ------- |
| `koan_get_profile` | Read the global profile, learning mode, and per-project overrides. |
| `koan_update_profile` | Apply a partial profile update; reports changed fields. |
| `koan_inspect_project` | Report Koan state, bootstrap markers, document paths, and git policy. |
| `koan_start_session` | Initialize or resume a session; optionally captures raw intent and echoes the stored `rawIntent`. |
| `koan_get_next_question` | Return the question for the most unclear axis and cache it. |
| `koan_record_answer` | Record an answer (axis from input or the cached question) with optional host interpretation; returns a crystallize preview. |
| `koan_crystallize_documents` | Write recorded answers into managed document regions (`dryRun` supported). |
| `koan_get_status` | Summarize goal, status, next action, stale-state warnings, and the stored `rawIntent`. |
| `koan_update_status` | Write a status update into `koan/status.md` and the handoff document; reports the affected files. |
| `koan_record_bright_idea` | Record a classified idea plus a deterministic recommendation. |
| `koan_record_insight` | Append a product realization to `koan/philosophy.md` (append-only insight log). |
| `koan_synthesize_prd` | Synthesize `koan/prd.md`; hosts may supply vision, core value, problem/anti-problem, and user stories grounded in recorded answers. |
| `koan_prepare_qa` | Generate `koan/qa.md` with spec-compliance and quality checks; embeds an optional implementation summary and returns the checklist. |
| `koan_prepare_handoff` | Generate `koan/handoff.md` (summary text optional); returns the document and next action; touchless handoff stays disabled. |
| `koan_get_dashboard` | Read-only snapshot of session phase, per-axis clarity, next question, insights, and warnings — the same data behind `koan dashboard`. |
| `koan_accept_clarity` | Accept current clarity and mark the session ready (the MCP equivalent of `koan enough`). |
| `koan_archive_goal` | Archive the active goal to `koan/archive/<goal-id>/` (the MCP equivalent of `koan status --archive`). |

All tool results are JSON in the first text content block; inputs are
zod-validated and failures surface as MCP errors.

Koan uses a semantic-host model: the core stays deterministic (state, scoring,
managed document writes) while the host agent supplies interpretation —
rephrasing questions, structuring answers, and scoring clarity through
`interpretation.clarity` on `koan_record_answer`. Without a host, the CLI runs
the same flow with built-in templates.

## Agent Skills

`koan connect claude` (or `codex`, or `both`) installs a `/koan` skill so the
whole journey works without leaving your agent: it writes
`~/.claude/skills/koan/SKILL.md` or `~/.codex/prompts/koan.md` and attempts
MCP registration (`claude mcp add` / `codex mcp add`), printing the manual
command if that fails. The skill is a playbook, not a second implementation:
it maps every CLI command to its MCP tool, carries the clarity-scoring rubric
hosts should use for `interpretation.clarity`, and falls back to the `koan`
CLI when MCP is unavailable. Re-run `koan connect` after upgrading to refresh
the installed skill. The first-run onboarding offers this install
automatically.

## Project Files

Human-facing memory lives in `koan/`; machine state lives in `.koan/`.

- Core documents (always created): `koan/README.md`, `koan/goal.md`,
  `koan/status.md`, `koan/plan.md`.
- Lazy documents (created on first use): `koan/philosophy.md`,
  `koan/decisions.md`, `koan/open-questions.md`, `koan/qa.md`,
  `koan/handoff.md`, `koan/bright-ideas.md`, `koan/prd.md`.
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

A new session starts at the why layer: `purpose` and `philosophical_intent`
are asked before goal shaping and implementation planning, so the deeper
reason behind the product is captured before features are specified. Users
who want a shorter path can answer briefly and run `koan enough` at any time
to accept the current clarity and move on.

Question phrasing adapts to the user profile: language (`ko`, `en`, `mixed`)
crossed with four development-understanding levels. A goal converges when every
axis reaches the convergence threshold (default `0.7`), configurable as
`settings.convergenceThreshold` in `.koan/project.json`. Crystallized
documents put philosophy first; `koan/philosophy.md` is the document future
contributors and agents should read before changing scope.

`koan prd` synthesizes the answers into a single PRD (`koan/prd.md`) ordered
philosophy-first: the deterministic core fills every section it has answers
for, and host agents may enrich the vision, core-value, problem/anti-problem,
and user-story sections through `koan_synthesize_prd` — always grounded in
what the user actually said. `koan insight` keeps an append-only log of the
moments when the real product turned out to differ from the surface request.

Instructions to host agents adapt to the connected MCP client (detected
locally from the MCP handshake — Claude, Codex/OpenAI, or generic): the
phrasing follows each model family's prompting guidance while the contract
stays identical across hosts. See `docs/host-adapters.md`.

## Privacy

Koan has no telemetry and does not transmit profile, project, or answer data
over the network. The global user profile is stored at `~/.koan/profile.json`.
Profile inference is allowlist-only: hosts may propose updates to the declared
profile fields and nothing else, and the default `approval_required` learning
mode keeps changes user-approved.
