export const CATEGORIES = [
  "AI Development",
  "Codex",
  "Claude Code",
  "AI Agents",
  "MCP",
  "Test Automation",
  "Software Engineering",
  "DevOps",
  "LLM Research",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CLAIM_CLASSES = [
  "FACT",
  "OBSERVATION",
  "INFERENCE",
  "HYPOTHESIS",
  "IDEA",
] as const;

export type ClaimClass = (typeof CLAIM_CLASSES)[number];

export const SOURCE_TYPES = [
  "x",
  "zenn",
  "qiita",
  "manual",
  "fixture",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const EXPERIMENT_STATUSES = [
  "proposed",
  "approved",
  "in_progress",
  "completed",
  "rejected",
  "blocked",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const DRAFT_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "published",
  "rejected",
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const PROCESSING_OPERATIONS = [
  "collect",
  "analyze",
  "rank",
  "experiment",
  "draft",
  "digest",
  "migrate",
] as const;

export type ProcessingOperation = (typeof PROCESSING_OPERATIONS)[number];

export const PROCESSING_STATUSES = [
  "running",
  "succeeded",
  "failed",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const HYPOTHESIS_SUPPORT_VALUES = [
  "supported",
  "partially_supported",
  "not_supported",
  "inconclusive",
] as const;

export type HypothesisSupport =
  (typeof HYPOTHESIS_SUPPORT_VALUES)[number];
