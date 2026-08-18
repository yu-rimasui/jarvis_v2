import type { DatabaseSync } from "node:sqlite";
import { ContentDraftService } from "../application/content-draft-service.js";
import { DailyDigestService } from "../application/daily-digest-service.js";
import { ExperimentService } from "../application/experiment-service.js";
import { ResearchPipeline } from "../application/research-pipeline.js";
import { PracticeWorkflowService } from "../application/practice-workflow-service.js";
import { RssCollectionService } from "../application/rss-collection-service.js";
import { loadRdIntelligenceConfiguration } from "../configuration.js";
import type { Logger } from "../logging/logger.js";
import { FakeLlmProvider } from "../providers/fake-llm-provider.js";
import { OllamaProvider } from "../providers/ollama-provider.js";
import { KnowledgeVault } from "../vault/knowledge-vault.js";
import { SqliteCollectorStateRepository } from "../storage/sqlite/collector-state-repository.js";
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
  readonly enableLocalIntegrations?: boolean;
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
  const configuration = loadRdIntelligenceConfiguration();
  const vault = options.enableLocalIntegrations
    ? new KnowledgeVault({
        vaultPath: configuration.vaultPath,
        areaPath: configuration.areaPath,
      })
    : undefined;
  const ollama = options.enableLocalIntegrations
    ? new OllamaProvider({
        baseUrl: configuration.ollamaBaseUrl,
        model: configuration.ollamaModel,
      })
    : undefined;

  const pipeline = new ResearchPipeline({
    repositories: {
      sourceItems,
      topicClusters,
      analyses,
      processingRuns,
    },
    llmProvider: ollama ?? new FakeLlmProvider(),
    ...(vault === undefined
      ? {}
      : {
          analysisSink: {
            saveInput: async (
              ...args: Parameters<KnowledgeVault["saveInput"]>
            ) => {
              await vault.saveInput(...args);
            },
          },
        }),
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
    ...(ollama === undefined ? {} : { xDraftProvider: ollama }),
    ...(vault === undefined ? {} : { vault }),
  });
  const digestService = new DailyDigestService({
    dailyDigests: new SqliteDailyDigestRepository(initialized.database),
    processingRuns,
    logger: options.logger,
  });
  const collections = new RssCollectionService({
    pipeline,
    collectorStates: new SqliteCollectorStateRepository(initialized.database),
  });
  const practice =
    vault === undefined
      ? undefined
      : new PracticeWorkflowService({
          analyses,
          sourceItems,
          experimentRepository: experiments,
          experiments: experimentService,
          vault,
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
      collections,
      ...(practice === undefined ? {} : { practice }),
      readiness: async () => ({
        vault:
          vault === undefined
            ? { available: false, areaPath: configuration.areaPath }
            : await vault.readiness(),
        ollama:
          ollama === undefined
            ? { reachable: false, modelAvailable: false }
            : await ollama.readiness(),
        model: configuration.ollamaModel,
      }),
    }),
    database: initialized.database,
    close: () => {
      initialized.database.close();
    },
  };
}
