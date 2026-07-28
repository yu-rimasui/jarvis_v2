import type { DatabaseSync } from "node:sqlite";
import { ContentDraftService } from "../application/content-draft-service.js";
import { DailyDigestService } from "../application/daily-digest-service.js";
import { ExperimentService } from "../application/experiment-service.js";
import { ResearchPipeline } from "../application/research-pipeline.js";
import type { Logger } from "../logging/logger.js";
import { FakeLlmProvider } from "../providers/fake-llm-provider.js";
import { SqliteContentDraftRepository } from "../storage/sqlite/content-draft-repository.js";
import { SqliteDailyDigestRepository } from "../storage/sqlite/daily-digest-repository.js";
import { SqliteExperimentRepository } from "../storage/sqlite/experiment-repository.js";
import { initializeDatabase } from "../storage/sqlite/initialize.js";
import {
  SqliteAnalysisRepository,
  SqliteProcessingRunRepository,
  SqliteSourceItemRepository,
  SqliteTopicClusterRepository,
} from "../storage/sqlite/pipeline-repositories.js";
import { LocalApiApplication } from "./local-api-application.js";

export interface LocalApiRuntimeOptions {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
  readonly logger: Logger;
}

export interface LocalApiRuntime {
  readonly application: LocalApiApplication;
  readonly database: DatabaseSync;
  close(): void;
}

export function createLocalApiRuntime(
  options: LocalApiRuntimeOptions,
): LocalApiRuntime {
  const initialized = initializeDatabase(options);
  const sourceItems = new SqliteSourceItemRepository(
    initialized.database,
  );
  const topicClusters = new SqliteTopicClusterRepository(
    initialized.database,
  );
  const analyses = new SqliteAnalysisRepository(initialized.database);
  const processingRuns = new SqliteProcessingRunRepository(
    initialized.database,
  );
  const experiments = new SqliteExperimentRepository(
    initialized.database,
  );
  const drafts = new SqliteContentDraftRepository(
    initialized.database,
  );

  const pipeline = new ResearchPipeline({
    repositories: {
      sourceItems,
      topicClusters,
      analyses,
      processingRuns,
    },
    llmProvider: new FakeLlmProvider(),
    logger: options.logger,
  });
  const experimentService = new ExperimentService({
    analyses,
    experiments,
    processingRuns,
    logger: options.logger,
  });
  const draftService = new ContentDraftService({
    analyses,
    sourceItems,
    experiments,
    drafts,
    processingRuns,
    logger: options.logger,
  });
  const digestService = new DailyDigestService({
    dailyDigests: new SqliteDailyDigestRepository(initialized.database),
    processingRuns,
    logger: options.logger,
  });

  return {
    application: new LocalApiApplication({
      pipeline,
      sourceItems,
      analyses,
      experiments: experimentService,
      drafts: draftService,
      processingRuns,
      digests: digestService,
    }),
    database: initialized.database,
    close: () => {
      initialized.database.close();
    },
  };
}
