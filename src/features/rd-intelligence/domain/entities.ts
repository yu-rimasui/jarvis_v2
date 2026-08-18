import type {
  Category,
  ClaimClass,
  DraftStatus,
  ExperimentStatus,
  HypothesisSupport,
  ProcessingOperation,
  ProcessingStatus,
  SourceType,
  TrialDifficulty,
} from "./enums.js";

export type EntityId = string;
export type IsoDateTime = string;
export type IsoDate = string;

export interface SourceItem {
  readonly id: EntityId;
  readonly sourceType: SourceType;
  readonly sourceExternalId?: string;
  readonly title: string;
  readonly author: string;
  readonly content: string;
  readonly canonicalUrl?: string;
  readonly normalizedUrl?: string;
  readonly contentHash: string;
  readonly publishedAt?: IsoDateTime;
  readonly collectedAt: IsoDateTime;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly topicKey?: string;
}

export interface TopicCluster {
  readonly id: EntityId;
  readonly key: string;
  readonly title: string;
  readonly createdAt: IsoDateTime;
}

export interface ClassifiedClaim {
  readonly claimClass: ClaimClass;
  readonly text: string;
  readonly sourceUrl?: string;
}

export interface ScoreComponent {
  readonly score: number;
  readonly reason: string;
}

export interface Analysis {
  readonly id: EntityId;
  readonly sourceItemId: EntityId;
  readonly summary: string;
  readonly primaryCategory: Category;
  readonly secondaryCategories: readonly Category[];
  readonly confidence: number;
  readonly confidenceReason: string;
  readonly whyItMatters: string;
  readonly workUse: string;
  readonly suggestedFirstExperiment: string;
  readonly trialDifficulty: TrialDifficulty;
  readonly requiredEnvironment: readonly string[];
  readonly hypothesis: string;
  readonly expectedValue: string;
  readonly estimatedEffort: string;
  readonly successCriteria: string;
  readonly verificationMethod: string;
  readonly relatedTechnologies: readonly string[];
  readonly relatedRepositories: readonly string[];
  readonly risksAndLimitations: readonly string[];
  readonly claims: readonly ClassifiedClaim[];
  readonly providerId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly analyzedAt: IsoDateTime;
}

export interface Ranking {
  readonly id: EntityId;
  readonly analysisId: EntityId;
  readonly relevance: ScoreComponent;
  readonly novelty: ScoreComponent;
  readonly actionability: ScoreComponent;
  readonly authorCredibility: ScoreComponent;
  readonly overallScore: number;
  readonly rankedAt: IsoDateTime;
}

export interface Experiment {
  readonly id: EntityId;
  readonly sourceAnalysisId: EntityId;
  readonly title: string;
  readonly hypothesis: string;
  readonly expectedValue: string;
  readonly smallestFirstStep: string;
  readonly requiredTools: readonly string[];
  readonly estimatedEffort: string;
  readonly risk: string;
  readonly successCriteria: string;
  readonly verificationMethod: string;
  readonly status: ExperimentStatus;
  readonly result?: string;
  readonly learned?: string;
  readonly nextDecision?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ExperimentRun {
  readonly id: EntityId;
  readonly experimentId: EntityId;
  readonly sequence: number;
  readonly result: string;
  readonly verificationEvidence: string;
  readonly startedAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
}

export interface ExperimentEvent {
  readonly id: EntityId;
  readonly experimentId: EntityId;
  readonly fromStatus?: ExperimentStatus;
  readonly toStatus: ExperimentStatus;
  readonly reason?: string;
  readonly createdAt: IsoDateTime;
}

export interface Learning {
  readonly id: EntityId;
  readonly experimentId: EntityId;
  readonly hypothesisSupport: HypothesisSupport;
  readonly reusableKnowledge: string;
  readonly nextExperiment?: string;
  readonly publishableFirstHandExperience?: string;
  readonly createdAt: IsoDateTime;
}

export type ContentEvidenceKind =
  | "SOURCE"
  | "INTERPRETATION"
  | "EXPERIENCE"
  | "EXPERIMENT_RESULT"
  | "HYPOTHESIS";

export interface ContentEvidence {
  readonly kind: ContentEvidenceKind;
  readonly text: string;
  readonly sourceUrl?: string;
}

export interface ContentDraft {
  readonly id: EntityId;
  readonly platform: "x" | "instagram";
  readonly relatedAnalysisId: EntityId;
  readonly relatedExperimentId?: EntityId;
  readonly hook: string;
  readonly body: string;
  readonly keyTakeaway: string;
  readonly sourceLinks: readonly string[];
  readonly characterCount: number;
  readonly status: DraftStatus;
  readonly evidenceScope: "source_only" | "completed_experiment";
  readonly provenance: readonly ContentEvidence[];
  readonly providerId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly generatedAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface ContentDraftEvent {
  readonly id: EntityId;
  readonly contentDraftId: EntityId;
  readonly fromStatus?: DraftStatus;
  readonly toStatus: DraftStatus;
  readonly reason?: string;
  readonly createdAt: IsoDateTime;
}

export interface ProcessingRun {
  readonly id: EntityId;
  readonly operation: ProcessingOperation;
  readonly sourceOrProvider: string;
  readonly status: ProcessingStatus;
  readonly receivedCount: number;
  readonly insertedCount: number;
  readonly duplicateCount: number;
  readonly processedCount: number;
  readonly failedCount: number;
  readonly retryCount: number;
  readonly errorCode?: string;
  readonly errorKind?: string;
  readonly startedAt: IsoDateTime;
  readonly finishedAt?: IsoDateTime;
}

export interface DailyDigest {
  readonly localDate: IsoDate;
  readonly timeZone: "Asia/Tokyo";
  readonly topInsightIds: readonly EntityId[];
  readonly proposedExperimentIds: readonly EntityId[];
  readonly activeExperimentIds: readonly EntityId[];
  readonly previousDayCompletedExperimentIds: readonly EntityId[];
  readonly draftCandidateIds: readonly EntityId[];
  readonly duplicateCount: number;
  readonly lowConfidenceCount: number;
  readonly processingFailureCount: number;
  readonly generatedAt: IsoDateTime;
}
