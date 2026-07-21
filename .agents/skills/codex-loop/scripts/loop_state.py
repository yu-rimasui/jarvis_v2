#!/usr/bin/env python3
"""Initialize, validate, and checkpoint a bounded Codex task loop."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
STAGE_STATUSES = {"pending", "running", "succeeded", "failed", "blocked", "skipped"}
FINISH_STATUSES = STAGE_STATUSES - {"pending", "running"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"Top-level JSON value must be an object: {path}")
    return data


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema_version") != 1:
        raise ValueError("manifest.schema_version must be 1")
    if not isinstance(manifest.get("name"), str) or not manifest["name"].strip():
        raise ValueError("manifest.name must be a non-empty string")
    policy = manifest.get("policy")
    if not isinstance(policy, dict):
        raise ValueError("manifest.policy must be an object")
    attempts = policy.get("max_attempts_per_stage", 2)
    if not isinstance(attempts, int) or attempts < 1:
        raise ValueError("policy.max_attempts_per_stage must be a positive integer")
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("manifest.tasks must be a non-empty array")

    seen_tasks: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict):
            raise ValueError("each task must be an object")
        task_id = task.get("id")
        if not isinstance(task_id, str) or not ID_RE.fullmatch(task_id):
            raise ValueError(f"invalid task id: {task_id!r}")
        if task_id in seen_tasks:
            raise ValueError(f"duplicate task id: {task_id}")
        task_agent = task.get("agent", "auto")
        if not isinstance(task_agent, str) or not ID_RE.fullmatch(task_agent):
            raise ValueError(f"invalid agent in {task_id}: {task_agent!r}")
        dependencies = task.get("depends_on", [])
        if not isinstance(dependencies, list) or not all(isinstance(x, str) for x in dependencies):
            raise ValueError(f"{task_id}.depends_on must be an array of task ids")
        missing_or_forward = [dep for dep in dependencies if dep not in seen_tasks]
        if missing_or_forward:
            raise ValueError(
                f"{task_id} dependencies must reference earlier tasks: {missing_or_forward}"
            )
        stages = task.get("stages")
        if not isinstance(stages, list) or not stages:
            raise ValueError(f"{task_id}.stages must be a non-empty array")
        seen_stages: set[str] = set()
        for stage in stages:
            if not isinstance(stage, dict):
                raise ValueError(f"each stage in {task_id} must be an object")
            stage_id = stage.get("id")
            if not isinstance(stage_id, str) or not ID_RE.fullmatch(stage_id):
                raise ValueError(f"invalid stage id in {task_id}: {stage_id!r}")
            if stage_id in seen_stages:
                raise ValueError(f"duplicate stage id in {task_id}: {stage_id}")
            stage_agent = stage.get("agent", task_agent)
            if not isinstance(stage_agent, str) or not ID_RE.fullmatch(stage_agent):
                raise ValueError(
                    f"invalid agent in {task_id}/{stage_id}: {stage_agent!r}"
                )
            verification = stage.get("verification", [])
            if not isinstance(verification, list) or not all(
                isinstance(item, str) and item.strip() for item in verification
            ):
                raise ValueError(
                    f"{task_id}/{stage_id}.verification must be an array of non-empty strings"
                )
            seen_stages.add(stage_id)
        seen_tasks.add(task_id)


def make_state(manifest: dict[str, Any], manifest_path: Path) -> dict[str, Any]:
    max_attempts = manifest["policy"].get("max_attempts_per_stage", 2)
    stamp = now()
    tasks: list[dict[str, Any]] = []
    for task in manifest["tasks"]:
        task_agent = task.get("agent", "auto")
        stages: list[dict[str, Any]] = []
        for stage in task["stages"]:
            stages.append(
                {
                    "id": stage["id"],
                    "title": stage.get("title", stage["id"]),
                    "agent": stage.get("agent", task_agent),
                    "prompt": stage.get("prompt", ""),
                    "verification": stage.get("verification", []),
                    "status": "pending",
                    "attempts": 0,
                    "max_attempts": max_attempts,
                    "attempt_history": [],
                    "summary": "",
                    "commits": [],
                    "tests": [],
                    "updated_at": None,
                }
            )
        tasks.append(
            {
                "id": task["id"],
                "title": task.get("title", task["id"]),
                "agent": task_agent,
                "depends_on": task.get("depends_on", []),
                "status": "pending",
                "stages": stages,
            }
        )
    return {
        "schema_version": 1,
        "loop_name": manifest["name"],
        "manifest_path": str(manifest_path),
        "created_at": stamp,
        "updated_at": stamp,
        "policy": manifest["policy"],
        "tasks": tasks,
    }


def task_status(task: dict[str, Any]) -> str:
    statuses = [stage["status"] for stage in task["stages"]]
    if all(status == "succeeded" for status in statuses):
        return "succeeded"
    if any(status == "running" for status in statuses):
        return "running"
    if any(status == "blocked" for status in statuses):
        return "blocked"
    if any(status == "skipped" for status in statuses):
        return "skipped"
    exhausted = any(
        stage["status"] == "failed" and stage["attempts"] >= stage["max_attempts"]
        for stage in task["stages"]
    )
    if exhausted:
        return "failed"
    return "pending"


def refresh_task_statuses(state: dict[str, Any]) -> None:
    for task in state["tasks"]:
        task["status"] = task_status(task)
    state["updated_at"] = now()


def validate_state(state: dict[str, Any]) -> None:
    if state.get("schema_version") != 1:
        raise ValueError("state.schema_version must be 1")
    if not isinstance(state.get("tasks"), list) or not state["tasks"]:
        raise ValueError("state.tasks must be a non-empty array")
    task_ids = {task.get("id") for task in state["tasks"]}
    if len(task_ids) != len(state["tasks"]):
        raise ValueError("state contains duplicate task ids")
    seen_task_ids: set[str] = set()
    for task in state["tasks"]:
        if not ID_RE.fullmatch(str(task.get("id", ""))):
            raise ValueError(f"invalid task id: {task.get('id')!r}")
        if not ID_RE.fullmatch(str(task.get("agent", "auto"))):
            raise ValueError(f"invalid agent in task {task['id']}")
        dependencies = task.get("depends_on", [])
        if not isinstance(dependencies, list) or not all(
            isinstance(dep, str) for dep in dependencies
        ):
            raise ValueError(f"invalid dependencies in {task['id']}")
        for dep in dependencies:
            if dep not in seen_task_ids:
                raise ValueError(
                    f"dependency must reference an earlier task: {dep!r} in {task['id']}"
                )
        stages = task.get("stages")
        if not isinstance(stages, list) or not stages:
            raise ValueError(f"{task['id']} has no stages")
        stage_ids: set[str] = set()
        for stage in stages:
            stage_id = stage.get("id")
            if not isinstance(stage_id, str) or not ID_RE.fullmatch(stage_id):
                raise ValueError(f"invalid stage id in {task['id']}: {stage_id!r}")
            if stage_id in stage_ids:
                raise ValueError(f"duplicate stage id in {task['id']}: {stage_id}")
            stage_ids.add(stage_id)
            if not ID_RE.fullmatch(str(stage.get("agent", task.get("agent", "auto")))):
                raise ValueError(f"invalid agent for {task['id']}/{stage_id}")
            if stage.get("status") not in STAGE_STATUSES:
                raise ValueError(f"invalid status for {task['id']}/{stage_id}")
            attempts = stage.get("attempts")
            maximum = stage.get("max_attempts")
            if not isinstance(attempts, int) or attempts < 0:
                raise ValueError(f"invalid attempts for {task['id']}/{stage_id}")
            if not isinstance(maximum, int) or maximum < 1 or attempts > maximum:
                raise ValueError(f"invalid max_attempts for {task['id']}/{stage_id}")
            verification = stage.get("verification", [])
            tests = stage.get("tests", [])
            if not isinstance(verification, list) or not all(
                isinstance(item, str) and item.strip() for item in verification
            ):
                raise ValueError(f"invalid verification for {task['id']}/{stage_id}")
            if not isinstance(tests, list) or not all(
                isinstance(item, str) and item.strip() for item in tests
            ):
                raise ValueError(f"invalid tests for {task['id']}/{stage_id}")
            if stage.get("status") == "succeeded" and verification and not tests:
                raise ValueError(
                    f"successful stage requires verification evidence: {task['id']}/{stage_id}"
                )
        seen_task_ids.add(task["id"])


def find_task_stage(
    state: dict[str, Any], task_id: str, stage_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    for task in state["tasks"]:
        if task["id"] == task_id:
            for stage in task["stages"]:
                if stage["id"] == stage_id:
                    return task, stage
            raise ValueError(f"unknown stage: {task_id}/{stage_id}")
    raise ValueError(f"unknown task: {task_id}")


def dependencies_succeeded(state: dict[str, Any], task: dict[str, Any]) -> bool:
    statuses = {candidate["id"]: task_status(candidate) for candidate in state["tasks"]}
    return all(statuses.get(dep) == "succeeded" for dep in task.get("depends_on", []))


def next_action(state: dict[str, Any]) -> dict[str, Any]:
    refresh_task_statuses(state)
    for task in state["tasks"]:
        for stage in task["stages"]:
            if stage["status"] == "running":
                return {
                    "status": "recover",
                    "task_id": task["id"],
                    "stage_id": stage["id"],
                    "agent": stage.get("agent", task.get("agent", "auto")),
                    "message": "Inspect the interrupted running attempt before continuing.",
                }

    task_statuses = {task["id"]: task_status(task) for task in state["tasks"]}
    terminal_failures = {
        task_id: status
        for task_id, status in task_statuses.items()
        if status in {"failed", "blocked", "skipped"}
    }
    if (
        terminal_failures
        and not state.get("policy", {}).get("continue_independent_after_failure", True)
    ):
        return {
            "status": "blocked",
            "message": "The loop policy stops after a terminal task failure.",
            "task_statuses": task_statuses,
        }

    for task in state["tasks"]:
        if not dependencies_succeeded(state, task):
            continue
        previous_ok = True
        for stage in task["stages"]:
            retryable = (
                stage["status"] == "failed" and stage["attempts"] < stage["max_attempts"]
            )
            if previous_ok and (stage["status"] == "pending" or retryable):
                return {
                    "status": "actionable",
                    "task_id": task["id"],
                    "task_title": task["title"],
                    "stage_id": stage["id"],
                    "stage_title": stage["title"],
                    "agent": stage.get("agent", task.get("agent", "auto")),
                    "attempt": stage["attempts"] + 1,
                    "max_attempts": stage["max_attempts"],
                    "prompt": stage["prompt"],
                    "verification": stage["verification"],
                    "prior_attempts": stage["attempt_history"],
                }
            if stage["status"] != "succeeded":
                previous_ok = False

    statuses = list(task_statuses.values())
    if all(status in {"succeeded", "failed", "blocked", "skipped"} for status in statuses):
        return {"status": "complete", "task_statuses": task_statuses}
    return {
        "status": "blocked",
        "message": "No stage is actionable; inspect failed dependencies or interrupted state.",
        "task_statuses": task_statuses,
    }


def cmd_init(args: argparse.Namespace) -> None:
    manifest_path = Path(args.manifest)
    state_path = Path(args.state)
    if state_path.exists():
        raise ValueError(f"state already exists; validate/resume it: {state_path}")
    manifest = read_json(manifest_path)
    validate_manifest(manifest)
    state = make_state(manifest, manifest_path)
    write_json_atomic(state_path, state)
    print(json.dumps({"status": "initialized", "state": str(state_path)}, indent=2))


def cmd_validate(args: argparse.Namespace) -> None:
    state = read_json(Path(args.state))
    validate_state(state)
    print(json.dumps({"status": "valid", "state": args.state}, indent=2))


def cmd_next(args: argparse.Namespace) -> None:
    state_path = Path(args.state)
    state = read_json(state_path)
    validate_state(state)
    result = next_action(state)
    write_json_atomic(state_path, state)
    print(json.dumps(result, indent=2, ensure_ascii=False))


def cmd_start(args: argparse.Namespace) -> None:
    state_path = Path(args.state)
    state = read_json(state_path)
    validate_state(state)
    task, stage = find_task_stage(state, args.task, args.stage)
    if not dependencies_succeeded(state, task):
        raise ValueError(f"dependencies have not succeeded for {task['id']}")
    if stage["status"] == "running":
        raise ValueError("stage is already running")
    if stage["status"] not in {"pending", "failed"}:
        raise ValueError(f"cannot start stage with status {stage['status']}")
    if stage["attempts"] >= stage["max_attempts"]:
        raise ValueError("stage has exhausted its attempts")
    index = task["stages"].index(stage)
    if any(item["status"] != "succeeded" for item in task["stages"][:index]):
        raise ValueError("earlier stages have not succeeded")
    stage["attempts"] += 1
    stage["status"] = "running"
    stage["updated_at"] = now()
    stage["attempt_history"].append(
        {
            "attempt": stage["attempts"],
            "started_at": stage["updated_at"],
            "status": "running",
            "agent": stage.get("agent", task.get("agent", "auto")),
        }
    )
    refresh_task_statuses(state)
    write_json_atomic(state_path, state)
    print(
        json.dumps(
            {
                "status": "started",
                "task_id": task["id"],
                "stage_id": stage["id"],
                "agent": stage.get("agent", task.get("agent", "auto")),
                "attempt": stage["attempts"],
            },
            indent=2,
        )
    )


def cmd_finish(args: argparse.Namespace) -> None:
    state_path = Path(args.state)
    state = read_json(state_path)
    validate_state(state)
    task, stage = find_task_stage(state, args.task, args.stage)
    if stage["status"] != "running":
        raise ValueError("only a running stage can be finished")
    if args.status not in FINISH_STATUSES:
        raise ValueError(f"invalid finish status: {args.status}")
    if args.status == "succeeded" and stage.get("verification") and not args.test:
        raise ValueError(
            "succeeded requires at least one --test verification evidence entry"
        )
    if args.status in {"failed", "blocked", "skipped"} and not (args.note or "").strip():
        raise ValueError(f"{args.status} requires --note with failure or blocker context")
    stamp = now()
    stage["status"] = args.status
    stage["summary"] = args.note or ""
    stage["commits"] = args.commit or []
    stage["tests"] = args.test or []
    stage["updated_at"] = stamp
    attempt = stage["attempt_history"][-1]
    attempt.update(
        {
            "finished_at": stamp,
            "status": args.status,
            "summary": stage["summary"],
            "commits": stage["commits"],
            "tests": stage["tests"],
        }
    )
    refresh_task_statuses(state)
    write_json_atomic(state_path, state)
    print(
        json.dumps(
            {
                "status": "finished",
                "task_id": task["id"],
                "stage_id": stage["id"],
                "agent": stage.get("agent", task.get("agent", "auto")),
                "result": args.status,
                "retry_available": (
                    args.status == "failed" and stage["attempts"] < stage["max_attempts"]
                ),
            },
            indent=2,
        )
    )


def md_escape(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def render_progress(state: dict[str, Any]) -> str:
    refresh_task_statuses(state)
    action = next_action(state)
    lines = [
        "# Codex loop progress",
        "",
        f"- Loop: `{state['loop_name']}`",
        f"- Updated: `{state['updated_at']}`",
        f"- Next state: `{action['status']}`",
        "",
        "| Task | Stage | Agent | Status | Attempts |",
        "| --- | --- | --- | --- | --- |",
    ]
    for task in state["tasks"]:
        for stage in task["stages"]:
            lines.append(
                f"| {md_escape(task['id'])} | {md_escape(stage['id'])} | "
                f"{md_escape(stage.get('agent', task.get('agent', 'auto')))} | "
                f"{stage['status']} | {stage['attempts']}/{stage['max_attempts']} |"
            )
    lines.extend(["", "## Next", "", "```json", json.dumps(action, indent=2, ensure_ascii=False), "```", ""])
    return "\n".join(lines)


def render_todos(state: dict[str, Any]) -> str:
    lines = ["# Codex loop TODOs", ""]
    count = 0
    for task in state["tasks"]:
        for stage in task["stages"]:
            exhausted = stage["status"] == "failed" and stage["attempts"] >= stage["max_attempts"]
            if exhausted or stage["status"] in {"blocked", "skipped"}:
                count += 1
                lines.extend(
                    [
                        f"## {task['id']} / {stage['id']} — {stage['status']}",
                        "",
                        f"Agent: `{stage.get('agent', task.get('agent', 'auto'))}`",
                        "",
                        stage.get("summary") or "No summary recorded.",
                        "",
                    ]
                )
    if count == 0:
        lines.extend(["No exhausted failures, blockers, or skipped stages.", ""])
    return "\n".join(lines)


def render_summary(state: dict[str, Any]) -> str:
    refresh_task_statuses(state)
    lines = ["# Codex loop summary", ""]
    for task in state["tasks"]:
        lines.extend([f"## {task['id']} — {task['title']}", "", f"Status: **{task['status']}**", ""])
        for stage in task["stages"]:
            lines.extend(
                [
                    f"### {stage['id']} — {stage['status']}",
                    "",
                    f"Agent: `{stage.get('agent', task.get('agent', 'auto'))}`",
                    "",
                    stage.get("summary") or "No summary recorded.",
                    "",
                ]
            )
            if stage.get("commits"):
                lines.append("Commits: " + ", ".join(f"`{item}`" for item in stage["commits"]))
                lines.append("")
            if stage.get("tests"):
                lines.extend(["Checks:", ""])
                lines.extend(f"- {item}" for item in stage["tests"])
                lines.append("")
    return "\n".join(lines)


def cmd_checkpoint(args: argparse.Namespace) -> None:
    state_path = Path(args.state)
    state = read_json(state_path)
    validate_state(state)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "PROGRESS.md").write_text(render_progress(state), encoding="utf-8")
    (out_dir / "TODOS.md").write_text(render_todos(state), encoding="utf-8")
    (out_dir / "SUMMARY.md").write_text(render_summary(state), encoding="utf-8")
    write_json_atomic(state_path, state)
    print(json.dumps({"status": "checkpointed", "out_dir": str(out_dir)}, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="initialize state from a task manifest")
    init.add_argument("--manifest", required=True)
    init.add_argument("--state", required=True)
    init.set_defaults(func=cmd_init)

    validate = sub.add_parser("validate", help="validate an existing state file")
    validate.add_argument("--state", required=True)
    validate.set_defaults(func=cmd_validate)

    next_cmd = sub.add_parser("next", help="show the next actionable stage")
    next_cmd.add_argument("--state", required=True)
    next_cmd.set_defaults(func=cmd_next)

    start = sub.add_parser("start", help="mark a stage attempt running")
    start.add_argument("--state", required=True)
    start.add_argument("--task", required=True)
    start.add_argument("--stage", required=True)
    start.set_defaults(func=cmd_start)

    finish = sub.add_parser("finish", help="finish the active stage attempt")
    finish.add_argument("--state", required=True)
    finish.add_argument("--task", required=True)
    finish.add_argument("--stage", required=True)
    finish.add_argument("--status", required=True, choices=sorted(FINISH_STATUSES))
    finish.add_argument("--note")
    finish.add_argument("--commit", action="append")
    finish.add_argument("--test", action="append")
    finish.set_defaults(func=cmd_finish)

    checkpoint = sub.add_parser("checkpoint", help="write human-readable checkpoint files")
    checkpoint.add_argument("--state", required=True)
    checkpoint.add_argument("--out-dir", required=True)
    checkpoint.set_defaults(func=cmd_checkpoint)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        args.func(args)
        return 0
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
