import type { DraftStatus } from "./enums.js";

const ALLOWED_DRAFT_TRANSITIONS: Readonly<
  Record<DraftStatus, readonly DraftStatus[]>
> = {
  draft: ["needs_review", "rejected"],
  needs_review: ["approved", "rejected"],
  approved: ["needs_review", "published", "rejected"],
  rejected: ["draft"],
  published: [],
};

export function allowedDraftTransitions(
  status: DraftStatus,
): readonly DraftStatus[] {
  return ALLOWED_DRAFT_TRANSITIONS[status];
}

export function canTransitionDraft(
  from: DraftStatus,
  to: DraftStatus,
): boolean {
  return ALLOWED_DRAFT_TRANSITIONS[from].includes(to);
}

export function canEditDraft(status: DraftStatus): boolean {
  return status !== "published";
}

