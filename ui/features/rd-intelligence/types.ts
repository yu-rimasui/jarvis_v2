export interface SourceItemView {
  readonly author: string;
  readonly collectedAt: string;
  readonly content: string;
  readonly id: string;
  readonly sourceType: string;
  readonly title: string;
}

export interface ClaimView {
  readonly claimClass: string;
  readonly sourceUrl?: string;
  readonly text: string;
}

export interface AnalysisView {
  readonly claims: readonly ClaimView[];
  readonly confidence: number;
  readonly confidenceReason: string;
  readonly id: string;
  readonly primaryCategory: string;
  readonly risksAndLimitations: readonly string[];
  readonly suggestedFirstExperiment: string;
  readonly summary: string;
  readonly whyItMatters: string;
  readonly workUse: string;
}

export interface RankingView {
  readonly overallScore: number;
}

export interface RankedInsightView {
  readonly analysis: AnalysisView;
  readonly ranking: RankingView;
}

export interface InsightDetailView extends RankedInsightView {
  readonly sourceItem: SourceItemView;
}

export type ExperimentStatus =
  | "approved"
  | "blocked"
  | "completed"
  | "in_progress"
  | "proposed"
  | "rejected";

export interface ExperimentView {
  readonly estimatedEffort: string;
  readonly expectedValue: string;
  readonly hypothesis: string;
  readonly id: string;
  readonly risk: string;
  readonly smallestFirstStep: string;
  readonly sourceAnalysisId: string;
  readonly status: ExperimentStatus;
  readonly successCriteria: string;
  readonly title: string;
  readonly verificationMethod: string;
}

export interface ExperimentRunView {
  readonly result: string;
  readonly verificationEvidence: string;
}

export interface EventView {
  readonly createdAt: string;
  readonly reason?: string;
  readonly toStatus: string;
}

export interface LearningView {
  readonly hypothesisSupport: string;
  readonly nextExperiment?: string;
  readonly reusableKnowledge: string;
}

export interface ExperimentDetailView {
  readonly events: readonly EventView[];
  readonly experiment: ExperimentView;
  readonly learning?: LearningView;
  readonly runs: readonly ExperimentRunView[];
}

export type DraftStatus =
  | "approved"
  | "draft"
  | "needs_review"
  | "published"
  | "rejected";

export interface EvidenceView {
  readonly kind: string;
  readonly text: string;
}

export interface DraftView {
  readonly body: string;
  readonly characterCount: number;
  readonly evidenceScope: string;
  readonly hook: string;
  readonly id: string;
  readonly keyTakeaway: string;
  readonly provenance: readonly EvidenceView[];
  readonly relatedAnalysisId: string;
  readonly relatedExperimentId?: string;
  readonly sourceLinks: readonly string[];
  readonly status: DraftStatus;
}

export interface DraftDetailView {
  readonly draft: DraftView;
  readonly events: readonly EventView[];
}

export interface ProcessingRunView {
  readonly duplicateCount: number;
  readonly errorCode?: string;
  readonly failedCount: number;
  readonly finishedAt?: string;
  readonly id: string;
  readonly insertedCount: number;
  readonly operation: string;
  readonly processedCount: number;
  readonly sourceOrProvider: string;
  readonly startedAt: string;
  readonly status: string;
}

export interface RdSnapshot {
  readonly drafts: readonly DraftView[];
  readonly experiments: readonly ExperimentView[];
  readonly history: readonly ProcessingRunView[];
  readonly inbox: readonly SourceItemView[];
  readonly insights: readonly RankedInsightView[];
}

export type RdView = "drafts" | "experiments" | "history" | "inbox" | "insights";
