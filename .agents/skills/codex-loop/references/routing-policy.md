# Expert routing policy

Route sparsely: select one primary expert for a stage and add consultants only when a material cross-layer question exists. Do not spawn all experts for every task.

## Roles

| Agent | Route when the primary outcome concerns | Default access |
| --- | --- | --- |
| `curio` | research, documentation, unfamiliar code, options, requirements, evidence | read-only |
| `iris` | UI, UX, frontend state, accessibility, responsive layout, i18n | workspace-write |
| `forge` | APIs, services, domain logic, databases, auth, backend performance | workspace-write |
| `relay` | networking, protocols, TLS, proxies, trust boundaries, threat and failure analysis | read-only |
| `kernel` | OS behavior, processes, permissions, containers, build/CI, observability, deployment mechanics | workspace-write |

## Selection

1. Use `Stage.agent` when specified.
2. Otherwise inherit `Task.agent`.
3. When the effective value is `auto`:
   - choose `curio` first if facts, requirements, APIs, or the affected code path are unclear;
   - choose `iris` for browser/client-facing outcomes;
   - choose `forge` for server/data outcomes;
   - choose `relay` for communication or security-boundary analysis;
   - choose `kernel` for host/runtime/operations outcomes;
   - use built-in `worker` only when no custom role is available and the task is implementation-focused;
   - use built-in `explorer` only when no `curio` role is available and the task is read-heavy.
4. For cross-layer work, assign one primary writer. Ask read-only experts for bounded evidence or review, then let the primary writer integrate it.
5. If expert conclusions conflict, compare evidence and contracts. Escalate only product scope, irreversible choices, new external authority, or unresolved high-impact tradeoffs.

## Concurrency

- Run `iris`, `forge`, and `kernel` write stages sequentially in one checkout.
- Allow `curio` and `relay` consultations in parallel only when they do not mutate shared files or external systems.
- Keep subagent depth at one unless recursive delegation is explicitly justified.
- Retry with the same expert and prior failure context. Re-route only when the failure demonstrates a domain mismatch.

## Delegation contract

Give every expert:

- the stage outcome and verification criteria;
- relevant repository paths and authoritative inputs;
- inherited constraints and forbidden actions;
- the exact expected response: evidence, changed files, checks, commits, uncertainties, and blockers.

Require experts to communicate in the parent task's language and to distinguish verified facts from inference.
