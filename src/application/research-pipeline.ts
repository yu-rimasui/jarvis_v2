import { randomUUID } from "node:crypto";
import type { Collector } from "../collectors/collector.js";
import type {
  Analysis,
  ProcessingRun,
  SourceItem,
} from "../domain/entities.js";
import { createRanking } from "../domain/ranking.js";
import type { Logger } from "../logging/logger.js";
import { safeErrorContext } from "../logging/logger.js";
import type { LlmProvider } from "../providers/llm-provider.js";
import type {
  AnalysisRepository,
  ProcessingRunRepository,
  SourceItemRepository,
  TopicClusterRepository,
} from "../storage/repositories.js";
import { parseAnalysis } from "../validation/analysis-parser.js";
import { normalizeSourceItem } from "./normalization.js";
import { createTopicCluster } from "./topic-clustering.js";

export interface ResearchPipelineRepositories {
  readonly sourceItems: SourceItemRepository;
  readonly topicClusters: TopicClusterRepository;
  readonly analyses: AnalysisRepository;
  readonly processingRuns: ProcessingRunRepository;
}

export interface ResearchPipelineDependencies {
  readonly repositories: ResearchPipelineRepositories;
  readonly llmProvider: LlmProvider;
  readonly logger: Logger;
  readonly id?: () => string;
  readonly now?: () => Date;
}

export class PipelineExecutionError extends Error {
  readonly code = "PIPELINE_EXECUTION_FAILED";

  constructor(readonly runId: string) {
    super("The research pipeline failed; inspect processing history");
    this.name = "PipelineExecutionError";
  }
}

export class AnalysisBusyError extends Error {
  readonly code = "ANALYSIS_BUSY";

  constructor() {
    super("Analysis is already in progress; retry this run");
    this.name = "AnalysisBusyError";
  }
}

export class AnalysisClaimLostError extends Error {
  readonly code = "ANALYSIS_CLAIM_LOST";

  constructor() {
    super("Analysis claim ownership changed; retry this run");
    this.name = "AnalysisClaimLostError";
  }
}

interface MutableCounts {
  received: number;
  inserted: number;
  duplicate: number;
  processed: number;
  failed: number;
}

export class ResearchPipeline {
  private static readonly ANALYSIS_CLAIM_LEASE_MS = 5 * 60 * 1_000;
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(private readonly dependencies: ResearchPipelineDependencies) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async run(collector: Collector, retryCount = 0): Promise<ProcessingRun> {
    const runId = this.id();
    const startedAt = this.now().toISOString();
    const counts: MutableCounts = {
      received: 0,
      inserted: 0,
      duplicate: 0,
      processed: 0,
      failed: 0,
    };
    const sourceOrProvider = `${collector.sourceName}|${this.dependencies.llmProvider.providerId}`;

    let run = this.processingRun({
      runId,
      sourceOrProvider,
      status: "running",
      counts,
      retryCount,
      startedAt,
    });
    await this.dependencies.repositories.processingRuns.save(run);
    this.dependencies.logger.info("processing_run_started", {
      operation: "collect",
      runId,
      retryCount,
    });

    let activeClaim:
      | {
          readonly sourceItemId: string;
          readonly claimToken: string;
        }
      | undefined;

    try {
      const collected = await collector.collect();
      counts.received = collected.items.length;
      run = this.processingRun({
        runId,
        sourceOrProvider,
        status: "running",
        counts,
        retryCount,
        startedAt,
      });
      await this.dependencies.repositories.processingRuns.save(run);

      for (const rawItem of collected.items) {
        const normalizedItem = normalizeSourceItem(rawItem, {
          id: this.id,
          now: this.now,
        });
        const insertion =
          await this.dependencies.repositories.sourceItems.insert(
            normalizedItem,
          );
        let item = normalizedItem;

        if (insertion.status === "duplicate") {
          counts.duplicate += 1;
          const existingItem =
            await this.dependencies.repositories.sourceItems.findById(
              insertion.id,
            );
          if (existingItem === undefined) {
            throw new Error("Duplicate source item could not be reloaded");
          }

          item = existingItem;
        } else {
          counts.inserted += 1;
        }

        const claimedAt = this.now();
        const claimToken = this.id();
        const claimStatus =
          await this.dependencies.repositories.analyses.claimForProcessing(
            item.id,
            runId,
            claimToken,
            claimedAt.toISOString(),
            new Date(
              claimedAt.getTime() +
                ResearchPipeline.ANALYSIS_CLAIM_LEASE_MS,
            ).toISOString(),
          );

        if (claimStatus === "busy") {
          throw new AnalysisBusyError();
        }

        if (claimStatus === "already_analyzed") {
          const existingAnalysis =
            await this.dependencies.repositories.analyses.findBySourceItemId(
              item.id,
            );
          if (existingAnalysis === undefined) {
            throw new Error(
              "Analyzed source item could not be reloaded",
            );
          }
          await this.ensureTopicCluster(item, existingAnalysis);
          run = this.processingRun({
            runId,
            sourceOrProvider,
            status: "running",
            counts,
            retryCount,
            startedAt,
          });
          await this.dependencies.repositories.processingRuns.save(run);
          continue;
        }

        activeClaim = {
          sourceItemId: item.id,
          claimToken,
        };
        const providerOutput =
          await this.dependencies.llmProvider.analyze(item);
        const parsed = parseAnalysis(providerOutput);
        const analyzedAt = this.now().toISOString();
        const analysis: Analysis = {
          id: this.id(),
          sourceItemId: item.id,
          summary: parsed.summary,
          primaryCategory: parsed.primaryCategory,
          secondaryCategories: parsed.secondaryCategories,
          confidence: parsed.confidence,
          confidenceReason: parsed.confidenceReason,
          whyItMatters: parsed.whyItMatters,
          workUse: parsed.workUse,
          suggestedFirstExperiment: parsed.suggestedFirstExperiment,
          relatedTechnologies: parsed.relatedTechnologies,
          relatedRepositories: parsed.relatedRepositories,
          risksAndLimitations: parsed.risksAndLimitations,
          claims: parsed.claims,
          providerId: this.dependencies.llmProvider.providerId,
          modelId: this.dependencies.llmProvider.modelId,
          promptVersion: this.dependencies.llmProvider.promptVersion,
          schemaVersion: this.dependencies.llmProvider.schemaVersion,
          analyzedAt,
        };
        const ranking = createRanking(analysis.id, parsed.scores, {
          id: this.id,
          now: this.now,
        });
        const saveStatus =
          await this.dependencies.repositories.analyses.saveClaimed(
            analysis,
            ranking,
            runId,
            claimToken,
          );
        activeClaim = undefined;

        if (saveStatus === "claim_lost") {
          throw new AnalysisClaimLostError();
        }

        if (saveStatus === "already_analyzed") {
          const existingAnalysis =
            await this.dependencies.repositories.analyses.findBySourceItemId(
              item.id,
            );
          if (existingAnalysis === undefined) {
            throw new Error(
              "Concurrent analysis could not be reloaded",
            );
          }
          await this.ensureTopicCluster(item, existingAnalysis);
          run = this.processingRun({
            runId,
            sourceOrProvider,
            status: "running",
            counts,
            retryCount,
            startedAt,
          });
          await this.dependencies.repositories.processingRuns.save(run);
          continue;
        }

        await this.ensureTopicCluster(item, analysis);

        counts.processed += 1;
        run = this.processingRun({
          runId,
          sourceOrProvider,
          status: "running",
          counts,
          retryCount,
          startedAt,
        });
        await this.dependencies.repositories.processingRuns.save(run);
      }

      run = this.processingRun({
        runId,
        sourceOrProvider,
        status: "succeeded",
        counts,
        retryCount,
        startedAt,
        finishedAt: this.now().toISOString(),
      });
      await this.dependencies.repositories.processingRuns.save(run);
      this.dependencies.logger.info("processing_run_succeeded", {
        operation: "collect",
        runId,
        count: counts.processed,
        retryCount,
      });
      return run;
    } catch (error) {
      if (activeClaim !== undefined) {
        try {
          await this.dependencies.repositories.analyses.releaseProcessingClaim(
            activeClaim.sourceItemId,
            runId,
            activeClaim.claimToken,
          );
        } catch {
          // Preserve the original pipeline failure. An expired lease is
          // recoverable, and an existing analysis wins over a stale claim.
        }
        activeClaim = undefined;
      }
      counts.failed += 1;
      const safeError = safeErrorContext(error);
      run = this.processingRun({
        runId,
        sourceOrProvider,
        status: "failed",
        counts,
        retryCount,
        startedAt,
        finishedAt: this.now().toISOString(),
        ...(safeError.errorCode === undefined
          ? {}
          : { errorCode: safeError.errorCode }),
        ...(safeError.errorKind === undefined
          ? {}
          : { errorKind: safeError.errorKind }),
      });
      await this.dependencies.repositories.processingRuns.save(run);
      this.dependencies.logger.error("processing_run_failed", {
        operation: "collect",
        runId,
        retryCount,
        ...safeError,
      });
      throw new PipelineExecutionError(runId);
    }
  }

  private async ensureTopicCluster(
    item: SourceItem,
    analysis: Analysis,
  ): Promise<void> {
    const candidateCluster = createTopicCluster(item, analysis, this.now);
    if (candidateCluster === undefined) return;

    const cluster =
      await this.dependencies.repositories.topicClusters.upsert(
        candidateCluster,
      );
    await this.dependencies.repositories.topicClusters.addItem(
      cluster.id,
      item.id,
    );
  }

  private processingRun(options: {
    readonly runId: string;
    readonly sourceOrProvider: string;
    readonly status: ProcessingRun["status"];
    readonly counts: MutableCounts;
    readonly retryCount: number;
    readonly startedAt: string;
    readonly finishedAt?: string;
    readonly errorCode?: string;
    readonly errorKind?: string;
  }): ProcessingRun {
    return {
      id: options.runId,
      operation: "collect",
      sourceOrProvider: options.sourceOrProvider,
      status: options.status,
      receivedCount: options.counts.received,
      insertedCount: options.counts.inserted,
      duplicateCount: options.counts.duplicate,
      processedCount: options.counts.processed,
      failedCount: options.counts.failed,
      retryCount: options.retryCount,
      ...(options.errorCode === undefined
        ? {}
        : { errorCode: options.errorCode }),
      ...(options.errorKind === undefined
        ? {}
        : { errorKind: options.errorKind }),
      startedAt: options.startedAt,
      ...(options.finishedAt === undefined
        ? {}
        : { finishedAt: options.finishedAt }),
    };
  }
}
