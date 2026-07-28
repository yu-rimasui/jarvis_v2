import { resolve } from "node:path";
import { ResearchPipeline } from "../application/research-pipeline.js";
import { FixtureCollector } from "../collectors/fixture-collector.js";
import {
  createLogger,
  safeErrorContext,
} from "../logging/logger.js";
import { FakeLlmProvider } from "../providers/fake-llm-provider.js";
import { initializeDatabase } from "../storage/sqlite/initialize.js";
import {
  SqliteAnalysisRepository,
  SqliteProcessingRunRepository,
  SqliteSourceItemRepository,
  SqliteTopicClusterRepository,
} from "../storage/sqlite/pipeline-repositories.js";

interface CliOptions {
  readonly databasePath: string;
  readonly fixturePath: string;
  readonly migrationsDirectory: string;
}

function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseOptions(args: readonly string[]): CliOptions {
  const allowed = new Set(["--database", "--fixture", "--migrations"]);
  for (const option of args.filter((value) => value.startsWith("--"))) {
    if (!allowed.has(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  return {
    databasePath: resolve(
      valueAfter(args, "--database") ?? "data/rd-intelligence.sqlite",
    ),
    fixturePath: resolve(
      valueAfter(args, "--fixture") ?? "fixtures/source-items.json",
    ),
    migrationsDirectory: resolve(
      valueAfter(args, "--migrations") ?? "migrations",
    ),
  };
}

const logger = createLogger();
let closeDatabase: (() => void) | undefined;

try {
  const options = parseOptions(process.argv.slice(2));
  const initialized = initializeDatabase({
    databasePath: options.databasePath,
    migrationsDirectory: options.migrationsDirectory,
    logger,
  });
  closeDatabase = () => {
    initialized.database.close();
  };

  const pipeline = new ResearchPipeline({
    repositories: {
      sourceItems: new SqliteSourceItemRepository(initialized.database),
      topicClusters: new SqliteTopicClusterRepository(initialized.database),
      analyses: new SqliteAnalysisRepository(initialized.database),
      processingRuns: new SqliteProcessingRunRepository(
        initialized.database,
      ),
    },
    llmProvider: new FakeLlmProvider(),
    logger,
  });
  const run = await pipeline.run(
    new FixtureCollector(options.fixturePath),
  );
  logger.info("pipeline_cli_completed", {
    operation: "collect",
    runId: run.id,
    count: run.processedCount,
  });
} catch (error) {
  logger.error("pipeline_cli_failed", {
    operation: "collect",
    ...safeErrorContext(error),
  });
  process.exitCode = 1;
} finally {
  closeDatabase?.();
}
