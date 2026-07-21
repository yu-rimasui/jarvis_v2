[[CODEX_LOOP name="<kebab-case-name>" goal="<measurable completion condition>"]]

# Long autonomous Codex run

Use `$codex-loop` to execute the tasks below as a bounded, resumable, sequential run.

## Outcome

<Describe the final reviewable result.>

## Global constraints

- Work from the repository root resolved by Codex; do not hard-code machine-specific paths in tracked state.
- Preserve unrelated working-tree changes.
- Use fresh bounded subagents for isolated stages when available.
- Route stages across `curio`, `iris`, `forge`, `relay`, and `kernel`; use `auto` when the orchestrator should choose.
- Run all write stages sequentially in the shared checkout.
- Retry a failed stage once with its failure context.
- Continue after an exhausted failure only for tasks that do not depend on it.
- Commit locally: `<yes/no; cadence>`.
- Never push, create a remote PR, tag, deploy, publish, or contact third parties.
- Branch/worktree policy: `<current branch / named branch / no worktrees>`.
- Pause for approval when an action needs authority not granted here.

## Verification

- Repository-wide checks: `<commands or criteria>`.
- Known pre-existing failures: `<exact tests/issues, with evidence>`.
- Done means: `<measurable completion criteria>`.

## Tasks

### Task 1 — <title>

- Outcome: <result>
- Primary agent: <auto/curio/iris/forge/relay/kernel>
- Authoritative inputs: <files/URLs>
- Constraints: <task-specific rules>
- Stages: <inspect/discuss, plan, implement, verify>
- Depends on: none

### Task 2 — <title>

- Outcome: <result>
- Primary agent: <auto/curio/iris/forge/relay/kernel>
- Authoritative inputs: <files/URLs>
- Constraints: <task-specific rules>
- Stages: <inspect, implement, verify>
- Depends on: Task 1

## Failure and checkpoint policy

- Keep machine state in `.codex/loop/<name>/state.json`.
- Regenerate `.codex/loop/<name>/PROGRESS.md`, `TODOS.md`, and `SUMMARY.md` after every attempt.
- Execute exactly one actionable stage per automatic continuation, checkpoint it, then stop.
- If context is compacted or the run is interrupted, resume from state instead of restarting completed work.
- At the end, provide one report per task: shipped work, changed files, local commits, test results, skipped checks, and review items.
- Stop for my review after the report.
