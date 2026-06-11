# Koan

Koan is project-local memory for agentic coding work. It helps Codex, Claude,
and MCP-capable agents converge vague intent into readable project documents:
goals, plans, status, QA criteria, bright ideas, and handoff notes.

Koan is MCP-first, but not LLM-provider-first. The MVP does not call an LLM API
or transmit project data over the network. The core tool is deterministic; host
agents provide semantic reasoning through MCP.

## Install

```bash
npm install -g @m5max/koan
```

## Commands

```bash
koan hello
koan status
koan bright-idea "Capture a new idea without changing the active plan"
koan qa
koan handoff "Summarize what the next agent should do"
```

## Project Files

Koan writes human-facing project memory into `koan/` and local state into
`.koan/`.

Core documents:

- `koan/goal.md`
- `koan/status.md`
- `koan/plan.md`

Lazy documents:

- `koan/philosophy.md`
- `koan/decisions.md`
- `koan/open-questions.md`
- `koan/qa.md`
- `koan/handoff.md`
- `koan/bright-ideas.md`

## Privacy

The MVP has no telemetry and does not transmit profile, project, or answer data
over the network. The global user profile is stored at `~/.koan/profile.json`.
