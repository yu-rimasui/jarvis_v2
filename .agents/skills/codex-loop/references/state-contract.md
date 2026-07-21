# Codex Loop state contract

## Manifest

Store the requested plan in `.codex/loop/<name>/tasks.json`.

```json
{
  "schema_version": 1,
  "name": "descriptive-run-name",
  "policy": {
    "max_attempts_per_stage": 2,
    "commit_mode": "never",
    "push": "never",
    "worktrees": "forbid",
    "continue_independent_after_failure": true
  },
  "tasks": [
    {
      "id": "task-1",
      "title": "Outcome-oriented title",
      "agent": "forge",
      "depends_on": [],
      "stages": [
        {
          "id": "inspect",
          "title": "Inspect current behavior",
          "agent": "curio",
          "prompt": "Inspect the relevant code and produce an evidence-backed implementation plan.",
          "verification": ["Record relevant files and constraints"]
        }
      ]
    }
  ]
}
```

IDs and agent names must use letters, digits, `_`, or `-`. Dependencies must reference earlier tasks. Every task needs at least one stage.

`Task.agent` sets the default expert for every stage in that task. `Stage.agent` overrides it. If neither is present, the effective value is `auto`, and the orchestrator selects an expert using `routing-policy.md`. Valid built-in fallbacks include `default`, `worker`, and `explorer`; the bundled custom roles are `curio`, `iris`, `forge`, `relay`, and `kernel`.

## Status model

Stage statuses:

- `pending`: not started;
- `running`: an attempt is active;
- `succeeded`: outcome and verification are acceptable;
- `failed`: attempt failed; retryable while attempts remain;
- `blocked`: cannot proceed without new authority or an external state change;
- `skipped`: deliberately omitted with a recorded reason.

Task status is derived from its stages. A task succeeds only when all stages succeed. `blocked`, `skipped`, and exhausted `failed` are terminal and do not satisfy dependencies.

## Attempt rules

- Increment attempts only on `start`.
- Allow one contextual retry by default (`max_attempts_per_stage = 2`).
- Store failure context in attempt history and pass it to the retrying agent.
- Preserve the same effective agent on retry unless the recorded failure shows that routing was wrong.
- Never convert a failure to success merely to advance the queue.
- Recover an interrupted `running` stage by inspecting actual files and logs before marking it.

## Safety invariants

- Only one write stage may run in a shared checkout at a time.
- Treat `curio` and `relay` as read-only by default. Treat `iris`, `forge`, and `kernel` as potential writers.
- Remote changes are outside the loop unless separately authorized.
- Local commits never imply permission to push.
- A task may not run until all dependencies have succeeded.
- Completion requires verification evidence or an explicit record that a check was unavailable.

## Files

`.codex/loop/<name>/state.json` is authoritative. Generated Markdown files are human-readable views and may be regenerated at any time.

- `PROGRESS.md`: current status and attempt counts.
- `TODOS.md`: exhausted failures, blockers, and skipped stages.
- `SUMMARY.md`: terminal task outcomes and recorded evidence.
