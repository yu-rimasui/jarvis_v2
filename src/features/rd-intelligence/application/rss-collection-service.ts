import type { ResearchPipeline } from "./research-pipeline.js";
import {
  DEFAULT_RSS_FEEDS,
  RssFeedCollector,
  type RssFeedDefinition,
} from "../collectors/rss-collector.js";
import { safeErrorContext } from "../logging/logger.js";
import type { CollectorStateRepository } from "../storage/repositories.js";

export interface FeedCollectionResult {
  readonly name: string;
  readonly status: "succeeded" | "failed";
  readonly receivedCount: number;
  readonly insertedCount: number;
  readonly duplicateCount: number;
  readonly processedCount: number;
  readonly runId?: string;
  readonly errorCode?: string;
}

export interface RssCollectionServiceDependencies {
  readonly pipeline: Pick<ResearchPipeline, "run">;
  readonly collectorStates: CollectorStateRepository;
  readonly feeds?: readonly RssFeedDefinition[];
  readonly now?: () => Date;
  readonly fetchImplementation?: typeof fetch;
}

export class RssCollectionService {
  private readonly feeds: readonly RssFeedDefinition[];
  private readonly now: () => Date;

  constructor(private readonly dependencies: RssCollectionServiceDependencies) {
    this.feeds = dependencies.feeds ?? DEFAULT_RSS_FEEDS;
    this.now = dependencies.now ?? (() => new Date());
  }

  async collect(): Promise<readonly FeedCollectionResult[]> {
    const results: FeedCollectionResult[] = [];
    for (const feed of this.feeds) {
      const started = this.now();
      const lastSuccessfulAt =
        await this.dependencies.collectorStates.findLastSuccessfulAt(
          feed.name,
        );
      const cutoff =
        lastSuccessfulAt === undefined
          ? new Date(started.getTime() - 24 * 60 * 60 * 1_000)
          : new Date(lastSuccessfulAt);
      try {
        const run = await this.dependencies.pipeline.run(
          new RssFeedCollector({
            definition: feed,
            cutoff,
            limit: 10,
            ...(this.dependencies.fetchImplementation === undefined
              ? {}
              : {
                  fetchImplementation:
                    this.dependencies.fetchImplementation,
                }),
          }),
        );
        const finishedAt = this.now().toISOString();
        await this.dependencies.collectorStates.saveLastSuccessfulAt(
          feed.name,
          started.toISOString(),
          finishedAt,
        );
        results.push({
          name: feed.name,
          status: "succeeded",
          receivedCount: run.receivedCount,
          insertedCount: run.insertedCount,
          duplicateCount: run.duplicateCount,
          processedCount: run.processedCount,
          runId: run.id,
        });
      } catch (error) {
        const safe = safeErrorContext(error);
        results.push({
          name: feed.name,
          status: "failed",
          receivedCount: 0,
          insertedCount: 0,
          duplicateCount: 0,
          processedCount: 0,
          ...(safe.errorCode === undefined
            ? {}
            : { errorCode: safe.errorCode }),
        });
      }
    }
    return results;
  }
}
