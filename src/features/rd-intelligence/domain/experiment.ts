import type { ExperimentStatus } from "./enums.js";

const ALLOWED_TRANSITIONS: Readonly<
  Record<ExperimentStatus, readonly ExperimentStatus[]>
> = {
  proposed: ["approved", "rejected", "blocked"],
  approved: ["in_progress", "rejected", "blocked"],
  in_progress: ["completed", "rejected", "blocked"],
  blocked: ["approved", "rejected"],
  completed: [],
  rejected: [],
};

export function allowedExperimentTransitions(
  status: ExperimentStatus,
): readonly ExperimentStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function canTransitionExperiment(
  from: ExperimentStatus,
  to: ExperimentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
