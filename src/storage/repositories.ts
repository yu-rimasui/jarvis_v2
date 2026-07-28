import type {
  Analysis,
  ContentDraft,
  ContentDraftEvent,
  DailyDigest,
  EntityId,
  Experiment,
  ExperimentEvent,
  ExperimentRun,
  Learning,
  ProcessingRun,
  Ranking,
  SourceItem,
  TopicCluster,
} from "../domain/entities.js";

export type InsertResult =
  | { readonly status: "inserted"; readonly id: EntityId }
  | {
      readonly status: "duplicate";
      readonly id: EntityId;
      readonly matchedBy:
        | "source_external_id"
        | "normalized_url"
        | "content_hash";
    };

export interface SourceItemRepository {
  insert(item: SourceItem): Promise<InsertResult>;
  findById(id: EntityId): Promise<SourceItem | undefined>;
  list(limit: number): Promise<readonly SourceItem[]>;
  listUnanalyzed(limit: number): Promise<readonly SourceItem[]>;
}

export interface TopicClusterRepository {
  upsert(cluster: TopicCluster): Promise<TopicCluster>;
  addItem(clusterId: EntityId, sourceItemId: EntityId): Promise<void>;
  listItems(clusterId: EntityId): Promise<readonly SourceItem[]>;
}

export interface AnalysisRepository {
  claimForProcessing(
    sourceItemId: EntityId,
    ownerRunId: EntityId,
    claimToken: EntityId,
    claimedAt: string,
    expiresAt: string,
  ): Promise<"claimed" | "already_analyzed" | "busy">;
  releaseProcessingClaim(
    sourceItemId: EntityId,
    ownerRunId: EntityId,
    claimToken: EntityId,
  ): Promise<void>;
  saveClaimed(
    analysis: Analysis,
    ranking: Ranking,
    ownerRunId: EntityId,
    claimToken: EntityId,
  ): Promise<"saved" | "already_analyzed" | "claim_lost">;
  findById(id: EntityId): Promise<Analysis | undefined>;
  findBySourceItemId(
    sourceItemId: EntityId,
  ): Promise<Analysis | undefined>;
  findRankedById(id: EntityId): Promise<
    | { readonly analysis: Analysis; readonly ranking: Ranking }
    | undefined
  >;
  listRanked(limit: number): Promise<
    readonly { readonly analysis: Analysis; readonly ranking: Ranking }[]
  >;
}

export interface ExperimentRepository {
  create(
    experiment: Experiment,
    event: ExperimentEvent,
  ): Promise<void>;
  update(
    experiment: Experiment,
    expectedUpdatedAt: string,
    event: ExperimentEvent,
  ): Promise<boolean>;
  complete(
    experiment: Experiment,
    expectedUpdatedAt: string,
    run: ExperimentRun,
    learning: Learning,
    event: ExperimentEvent,
  ): Promise<boolean>;
  findById(id: EntityId): Promise<Experiment | undefined>;
  list(): Promise<readonly Experiment[]>;
  listRuns(experimentId: EntityId): Promise<readonly ExperimentRun[]>;
  listEvents(experimentId: EntityId): Promise<readonly ExperimentEvent[]>;
  findLearning(experimentId: EntityId): Promise<Learning | undefined>;
}

export interface ContentDraftRepository {
  create(
    draft: ContentDraft,
    event: ContentDraftEvent,
  ): Promise<void>;
  update(
    draft: ContentDraft,
    expectedUpdatedAt: string,
    event: ContentDraftEvent,
  ): Promise<boolean>;
  findById(id: EntityId): Promise<ContentDraft | undefined>;
  list(): Promise<readonly ContentDraft[]>;
  listEvents(draftId: EntityId): Promise<readonly ContentDraftEvent[]>;
}

export interface DailyDigestQuery {
  readonly localDate: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly previousDayStartAt: string;
  readonly topInsightLimit: number;
  readonly lowConfidenceThreshold: number;
  readonly generatedAt: string;
}

export interface DailyDigestRepository {
  generate(query: DailyDigestQuery): Promise<DailyDigest>;
}

export interface ProcessingRunRepository {
  save(run: ProcessingRun): Promise<void>;
  findById(id: EntityId): Promise<ProcessingRun | undefined>;
  list(limit: number): Promise<readonly ProcessingRun[]>;
}

export interface RepositorySet {
  readonly sourceItems: SourceItemRepository;
  readonly topicClusters: TopicClusterRepository;
  readonly analyses: AnalysisRepository;
  readonly experiments: ExperimentRepository;
  readonly contentDrafts: ContentDraftRepository;
  readonly dailyDigests: DailyDigestRepository;
  readonly processingRuns: ProcessingRunRepository;
}
