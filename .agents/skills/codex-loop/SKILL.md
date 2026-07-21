---
name: codex-loop
description: Orchestrate long autonomous Codex work as a bounded, resumable sequence of tasks and stages routed across specialized custom agents, with dependency checks, isolated execution, one contextual retry, persistent checkpoints, verification, optional local commits, and a final review report. Use when a user asks Codex to run a long multi-phase session, process a task queue sequentially, coordinate expert subagents, continue past non-blocking failures, or resume an interrupted autonomous run.
---

# Codex Loop

Run a finite state machine, not an unbounded prompt loop. Keep the main agent focused on orchestration and preserve enough state on disk to resume safely. In this repository, automatic continuations are provided by the separately installed Codex Loop runtime, while this repository skill owns task decomposition, agent routing, and project-local checkpoints.

## Activate in this repository

Installation and status checks do not require an activation header. An active loop must follow `CODEX.md`: put exactly one bounded limiter on the first prompt line and start the task on the next line.

```text
[[CODEX_LOOP name="<kebab-case-name>" rounds="3"]]
[[CODEX_LOOP name="<kebab-case-name>" goal="<verifiable completion condition>"]]
```

Prefer a finite `rounds` value or a verifiable `goal`. Store every run under `.codex/loop/<name>/`; the name in the header and directory must match. The project `codex-loop.toml` points automatic continuations to this repository-local skill, avoiding ambiguity with a same-named global skill.

## Prepare

1. Read the user request, repository guidance, and referenced artifacts before execution.
2. Read [references/state-contract.md](references/state-contract.md) and [references/routing-policy.md](references/routing-policy.md).
3. Derive `<name>` from the activation header. Convert the requested work into a JSON manifest matching [assets/tasks.example.json](assets/tasks.example.json), and store it at `.codex/loop/<name>/tasks.json`. Preserve the user's task order.
4. Resolve contradictions before starting:
   - Treat explicit current-turn instructions as highest priority.
   - Treat referenced authoritative artifacts as source of truth within their stated scope.
   - Record unresolved material conflicts as blockers; do not guess through destructive or externally visible actions.
5. Inspect the repository, current branch, dirty worktree, permissions, and available verification commands.
6. Initialize state:

```bash
python3 <skill-dir>/scripts/loop_state.py init \
  --manifest .codex/loop/<name>/tasks.json \
  --state .codex/loop/<name>/state.json
```

Do not overwrite an existing state file. Validate and resume it instead.

## Execute one continuation

At the start of every continuation, run `next` once:

```bash
python3 <skill-dir>/scripts/loop_state.py next \
  --state .codex/loop/<name>/state.json
```

When it returns an actionable stage, perform exactly that one stage:

1. Mark it running with `start`.
2. Read the `agent` returned by `next`. If it is `auto`, select one expert using the routing policy. Prefer the requested custom agent when that agent is available.
3. Use a fresh bounded subagent when subagents are available and isolation was requested. Request the named custom agent type when supported. If named types are unavailable, follow the matching role boundaries in [references/routing-policy.md](references/routing-policy.md) and execute the stage locally. Pass only:
   - the concrete stage outcome and definition of done;
   - repository path and relevant source files;
   - inherited constraints;
   - prior failure context when retrying;
   - the requirement to return changed files, verification results, commits, and blockers.
4. Run write stages sequentially. Never let two agents modify the same checkout concurrently. Read-only consultations may run in parallel when they do not share mutable state.
5. If subagents are unavailable, execute the stage locally with the selected expert profile and the same boundaries.
6. Inspect the result and repository diff yourself. Do not accept a success claim without evidence.
7. Run the stage's verification commands. Record skipped checks and why.
8. Mark the stage `succeeded`, `failed`, `blocked`, or `skipped` with `finish`.
9. Generate checkpoints after every attempt:

```bash
python3 <skill-dir>/scripts/loop_state.py checkpoint \
  --state .codex/loop/<name>/state.json \
  --out-dir .codex/loop/<name>
```

10. Validate the state, summarize the stage outcome briefly, and stop so the runtime can decide whether another continuation is needed. Do not chain a second stage in the same continuation.

Use the helper with explicit task and stage identifiers:

```bash
python3 <skill-dir>/scripts/loop_state.py start \
  --state .codex/loop/<name>/state.json \
  --task <task-id> --stage <stage-id>

python3 <skill-dir>/scripts/loop_state.py finish \
  --state .codex/loop/<name>/state.json \
  --task <task-id> --stage <stage-id> \
  --status succeeded --note "<outcome>" --test "<verification evidence>"

python3 <skill-dir>/scripts/loop_state.py validate \
  --state .codex/loop/<name>/state.json
```

A successful stage with declared verification criteria requires at least one `--test` evidence entry. `failed`, `blocked`, and `skipped` require a non-empty `--note` explaining why.

Use at most two attempts per stage unless the user explicitly sets a different limit. On the second attempt, include the first failure's logs and changed state. After the retry fails, leave the stage failed, record the blocker, and continue only when downstream tasks do not depend on it.

## Git and external-action rules

- Preserve unrelated user changes.
- Commit only when the manifest and user instructions authorize local commits.
- Scope each commit to loop-owned changes and record its SHA.
- Never push, create a remote pull request, tag, deploy, publish, or message third parties unless separately and explicitly authorized.
- Never create a branch or worktree unless the manifest explicitly requires it.
- Do not bypass sandbox or approval boundaries. Pause for new authority when required.

## Dependency and stop rules

- Start a task only after every `depends_on` task succeeds.
- Continue past an exhausted failure only for independent later tasks.
- Mark dependent work blocked rather than attempting it against missing prerequisites.
- Stop when all tasks are terminal, a required user decision blocks all remaining work, or policy/permissions prevent meaningful progress.
- Never repeat a failed action indefinitely.

## Context management

Treat `.codex/loop/<name>/state.json` as the machine-readable source of truth. Keep:

- `.codex/loop/<name>/PROGRESS.md` for completed/current/remaining work;
- `.codex/loop/<name>/TODOS.md` for exhausted failures and review items;
- `.codex/loop/<name>/SUMMARY.md` for the final handoff.

Checkpoint before expected compaction or handoff. On resume, validate state, inspect the current worktree, reconcile any `running` stage with actual files/logs, then continue.

## Finish

Run final verification appropriate to the whole change set. Generate the checkpoint files one last time and report, per task:

- what shipped;
- changed files and local commits;
- tests/checks and results;
- skipped checks;
- blockers and items needing review.

Stop for review after the final report. Do not silently begin a new milestone.

## Project agents

Use the five project-scoped definitions under [`.codex/agents/`](../../../.codex/agents/):

- `curio`: read-only research, documentation, and evidence gathering;
- `iris`: frontend, UX, accessibility, responsive behavior, and i18n;
- `forge`: backend, APIs, data integrity, authentication, and performance;
- `relay`: read-only network, protocol, security-boundary, and failure analysis;
- `kernel`: OS, processes, containers, CI, observability, and operations.

`.codex/agents/` is the single source of truth for custom-agent instructions in this repository. The skill's `agents/openai.yaml` is separate UI metadata for the skill, not a custom-agent definition.
