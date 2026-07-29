import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  PipelineExecutionError,
  ResearchPipeline,
} from "../src/features/rd-intelligence/application/research-pipeline.js";
import type {
  Collector,
  CollectorResult,
} from "../src/features/rd-intelligence/collectors/collector.js";
import { FixtureCollector } from "../src/features/rd-intelligence/collectors/fixture-collector.js";
import { ManualImportCollector } from "../src/features/rd-intelligence/collectors/manual-import-collector.js";
import { XListTimelineCollector } from "../src/features/rd-intelligence/collectors/x-collector.js";
import type { SourceItem } from "../src/features/rd-intelligence/domain/entities.js";
import { createLogger } from "../src/features/rd-intelligence/logging/logger.js";
import { FakeLlmProvider } from "../src/features/rd-intelligence/providers/fake-llm-provider.js";
import type { LlmProvider } from "../src/features/rd-intelligence/providers/llm-provider.js";
import { initializeDatabase } from "../src/features/rd-intelligence/storage/sqlite/initialize.js";
import {
  SqliteAnalysisRepository,
  SqliteProcessingRunRepository,
  SqliteSourceItemRepository,
  SqliteTopicClusterRepository,
} from "../src/features/rd-intelligence/storage/sqlite/pipeline-repositories.js";

const temporaryDirectories: string[] = [];

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTestContext(
  provider: LlmProvider = new FakeLlmProvider(),
  now?: () => Date,
) {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-rd-pipeline-"));
  temporaryDirectories.push(directory);
  const logLines: string[] = [];
  const logger = createLogger((line) => {
    logLines.push(line);
  });
  const initialized = initializeDatabase({
    databasePath: join(directory, "pipeline.sqlite"),
    migrationsDirectory: resolve("migrations"),
    logger,
  });
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
  const pipeline = new ResearchPipeline({
    repositories: {
      sourceItems,
      topicClusters,
      analyses,
      processingRuns,
    },
    llmProvider: provider,
    logger,
    ...(now === undefined ? {} : { now }),
  });

  return {
    database: initialized.database,
    sourceItems,
    topicClusters,
    analyses,
    processingRuns,
    pipeline,
    logger,
    logLines,
  };
}

function countRows(
  database: ReturnType<typeof createTestContext>["database"],
  table: string,
): number {
  const allowed = new Set([
    "source_items",
    "analyses",
    "rankings",
    "topic_clusters",
    "topic_cluster_items",
    "processing_runs",
    "analysis_claims",
  ]);
  if (!allowed.has(table)) throw new Error("Unexpected table");

  const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get();
  const count = row?.["count"];
  if (typeof count !== "number") {
    throw new TypeError("Count query did not return a number");
  }
  return count;
}

test("fixture pipeline stores validated analysis, ranking, clusters, and idempotent history", async () => {
  const context = createTestContext();

  try {
    const collector = new FixtureCollector(
      resolve("fixtures/source-items.json"),
    );
    const first = await context.pipeline.run(collector);

    assert.equal(first.status, "succeeded");
    assert.equal(first.receivedCount, 3);
    assert.equal(first.insertedCount, 3);
    assert.equal(first.duplicateCount, 0);
    assert.equal(first.processedCount, 3);
    assert.equal(first.failedCount, 0);

    const ranked = await context.analyses.listRanked(10);
    assert.equal(ranked.length, 3);
    for (const item of ranked) {
      assert.equal(item.ranking.overallScore, 71);
      assert.equal(item.ranking.relevance.score, 4);
      assert.ok(item.ranking.relevance.reason.length > 0);
      assert.ok(item.ranking.novelty.reason.length > 0);
      assert.ok(item.ranking.actionability.reason.length > 0);
      assert.ok(item.ranking.authorCredibility.reason.length > 0);
      assert.ok(item.analysis.claims.length >= 2);
      assert.ok(item.analysis.schemaVersion.length > 0);
    }

    assert.equal(countRows(context.database, "source_items"), 3);
    assert.equal(countRows(context.database, "analyses"), 3);
    assert.equal(countRows(context.database, "rankings"), 3);
    assert.equal(countRows(context.database, "topic_clusters"), 2);
    assert.equal(countRows(context.database, "topic_cluster_items"), 3);

    const second = await context.pipeline.run(collector);
    assert.equal(second.status, "succeeded");
    assert.equal(second.receivedCount, 3);
    assert.equal(second.insertedCount, 0);
    assert.equal(second.duplicateCount, 3);
    assert.equal(second.processedCount, 0);
    assert.equal(countRows(context.database, "source_items"), 3);
    assert.equal(countRows(context.database, "analyses"), 3);

    const history = await context.processingRuns.list(10);
    assert.equal(history.length, 2);
    assert.ok(history.every((run) => run.status === "succeeded"));
  } finally {
    context.database.close();
  }
});

test("manual import detects normalized URL and content hash duplicates", async () => {
  const context = createTestContext();

  try {
    await context.pipeline.run(
      new FixtureCollector(resolve("fixtures/source-items.json")),
    );

    const duplicateRun = await context.pipeline.run(
      new ManualImportCollector([
        {
          sourceType: "manual",
          sourceExternalId: "manual-url-duplicate",
          title: "URL duplicate",
          author: "Synthetic User",
          content: "This body is intentionally different.",
          canonicalUrl:
            "https://example.test/x/fixture-x-001/?utm_campaign=local",
          sourceMetadata: { synthetic: true },
        },
        {
          sourceType: "manual",
          sourceExternalId: "manual-hash-duplicate",
          title: "Content duplicate",
          author: "Synthetic User",
          content:
            "検証用の合成投稿です。MCPのTypeScript SDK https://github.com/modelcontextprotocol/typescript-sdk を小さなローカル実験で確認します。",
          canonicalUrl: "https://example.test/manual/unique-url",
          sourceMetadata: { synthetic: true },
        },
      ]),
    );

    assert.equal(duplicateRun.receivedCount, 2);
    assert.equal(duplicateRun.insertedCount, 0);
    assert.equal(duplicateRun.duplicateCount, 2);
    assert.equal(countRows(context.database, "source_items"), 3);
  } finally {
    context.database.close();
  }
});

class BarrierLlmProvider implements LlmProvider {
  readonly providerId = "barrier-local-fake";
  readonly modelId = "barrier-deterministic-fixture-analyzer";
  readonly promptVersion = "analysis-v1";
  readonly schemaVersion = "analysis-v1";
  analyzeCallCount = 0;

  private readonly delegate = new FakeLlmProvider();
  private readonly firstAnalyzeStarted: Promise<void>;
  private readonly analyzeRelease: Promise<void>;
  private resolveFirstAnalyzeStarted!: () => void;
  private resolveAnalyzeRelease!: () => void;

  constructor() {
    this.firstAnalyzeStarted = new Promise((resolve) => {
      this.resolveFirstAnalyzeStarted = resolve;
    });
    this.analyzeRelease = new Promise((resolve) => {
      this.resolveAnalyzeRelease = resolve;
    });
  }

  async waitUntilFirstAnalyzeStarts(): Promise<void> {
    await this.firstAnalyzeStarted;
  }

  releaseAnalyze(): void {
    this.resolveAnalyzeRelease();
  }

  async analyze(item: SourceItem): Promise<unknown> {
    this.analyzeCallCount += 1;
    this.resolveFirstAnalyzeStarted();
    await this.analyzeRelease;
    return this.delegate.analyze(item);
  }
}

test(
  "concurrent pipeline runs analyze once and record the busy run for retry",
  { timeout: 5_000 },
  async () => {
    const provider = new BarrierLlmProvider();
    const context = createTestContext(provider);
    const competingPipeline = new ResearchPipeline({
      repositories: {
        sourceItems: context.sourceItems,
        topicClusters: context.topicClusters,
        analyses: context.analyses,
        processingRuns: context.processingRuns,
      },
      llmProvider: provider,
      logger: context.logger,
    });
    const collector = new ManualImportCollector([
      {
        sourceType: "manual",
        sourceExternalId: "concurrent-analysis-1",
        title: "Concurrent analysis fixture",
        author: "Synthetic User",
        content: "Synthetic content for a concurrent pipeline run.",
        canonicalUrl:
          "https://example.test/manual/concurrent-analysis-1",
        sourceMetadata: { synthetic: true },
      },
    ]);

    try {
      const firstRunPromise = context.pipeline.run(collector);
      await provider.waitUntilFirstAnalyzeStarts();

      let busyRunId = "";
      await assert.rejects(
        async () => competingPipeline.run(collector),
        (error: unknown) => {
          assert.ok(error instanceof PipelineExecutionError);
          busyRunId = error.runId;
          return true;
        },
      );
      provider.releaseAnalyze();

      const firstRun = await firstRunPromise;

      assert.equal(firstRun.status, "succeeded");
      assert.equal(provider.analyzeCallCount, 1);
      assert.equal(firstRun.processedCount, 1);
      assert.equal(countRows(context.database, "source_items"), 1);
      assert.equal(countRows(context.database, "analyses"), 1);
      assert.equal(countRows(context.database, "analysis_claims"), 0);

      const history = await context.processingRuns.list(10);
      assert.equal(history.length, 2);
      assert.equal(
        history.filter((run) => run.status === "succeeded").length,
        1,
      );
      const busyRun = await context.processingRuns.findById(busyRunId);
      assert.equal(busyRun?.status, "failed");
      assert.equal(busyRun?.errorCode, "ANALYSIS_BUSY");
    } finally {
      provider.releaseAnalyze();
      context.database.close();
    }
  },
);

test(
  "expired claim fencing prevents a stale owner from overwriting analysis",
  { timeout: 5_000 },
  async () => {
    const staleProvider = new BarrierLlmProvider();
    let currentTime = new Date("2026-07-28T00:00:00.000Z");
    const now = () => new Date(currentTime);
    const context = createTestContext(staleProvider, now);
    const currentProvider = new FakeLlmProvider();
    const currentPipeline = new ResearchPipeline({
      repositories: {
        sourceItems: context.sourceItems,
        topicClusters: context.topicClusters,
        analyses: context.analyses,
        processingRuns: context.processingRuns,
      },
      llmProvider: currentProvider,
      logger: context.logger,
      now,
    });
    const collector = new ManualImportCollector([
      {
        sourceType: "manual",
        sourceExternalId: "expired-claim-fencing-1",
        title: "Expired claim fencing fixture",
        author: "Synthetic User",
        content: "Synthetic content for analysis claim fencing.",
        canonicalUrl:
          "https://example.test/manual/expired-claim-fencing-1",
        sourceMetadata: { synthetic: true },
      },
    ]);

    try {
      const staleRunPromise = context.pipeline.run(collector);
      await staleProvider.waitUntilFirstAnalyzeStarts();

      currentTime = new Date("2026-07-28T00:06:00.000Z");
      const currentRun = await currentPipeline.run(collector);
      staleProvider.releaseAnalyze();
      const staleRun = await staleRunPromise;

      assert.equal(currentRun.status, "succeeded");
      assert.equal(currentRun.processedCount, 1);
      assert.equal(staleRun.status, "succeeded");
      assert.equal(staleRun.processedCount, 0);
      assert.equal(countRows(context.database, "analyses"), 1);
      assert.equal(countRows(context.database, "rankings"), 1);
      assert.equal(countRows(context.database, "analysis_claims"), 0);

      const ranked = await context.analyses.listRanked(10);
      assert.equal(ranked.length, 1);
      assert.equal(ranked[0]?.analysis.providerId, "local-fake");
    } finally {
      staleProvider.releaseAnalyze();
      context.database.close();
    }
  },
);

test("conflicting dedupe identities fail without merging sources", async () => {
  const context = createTestContext();
  const existingItems = [
    {
      sourceType: "manual",
      sourceExternalId: "dedupe-source-a",
      title: "Dedupe source A",
      author: "Synthetic User",
      content: "Original synthetic content for source A.",
      canonicalUrl: "https://example.test/manual/dedupe-source-a",
      sourceMetadata: { synthetic: true },
    },
    {
      sourceType: "manual",
      sourceExternalId: "dedupe-source-b",
      title: "Dedupe source B",
      author: "Synthetic User",
      content: "Original synthetic content for source B.",
      canonicalUrl: "https://example.test/manual/dedupe-source-b",
      sourceMetadata: { synthetic: true },
    },
  ];

  try {
    const initialRun = await context.pipeline.run(
      new ManualImportCollector(existingItems),
    );
    assert.equal(initialRun.status, "succeeded");
    assert.equal(countRows(context.database, "source_items"), 2);

    let failedRunId = "";
    await assert.rejects(
      async () => {
        await context.pipeline.run(
          new ManualImportCollector([
            {
              sourceType: "manual",
              sourceExternalId: "dedupe-source-a",
              title: "Conflicting dedupe identity",
              author: "Synthetic User",
              content:
                "Distinct synthetic content with crossed identity keys.",
              canonicalUrl:
                "https://example.test/manual/dedupe-source-b",
              sourceMetadata: { synthetic: true },
            },
          ]),
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof PipelineExecutionError);
        failedRunId = error.runId;
        return true;
      },
    );

    const failedRun = await context.processingRuns.findById(failedRunId);
    assert.equal(failedRun?.status, "failed");
    assert.equal(failedRun?.receivedCount, 1);
    assert.equal(failedRun?.insertedCount, 0);
    assert.equal(failedRun?.failedCount, 1);
    assert.equal(
      failedRun?.errorCode,
      "DEDUPE_IDENTITY_CONFLICT",
    );
    assert.equal(countRows(context.database, "source_items"), 2);
    assert.equal(countRows(context.database, "analyses"), 2);
  } finally {
    context.database.close();
  }
});

test("source identity duplicates keep the original immutable content", async () => {
  const context = createTestContext();
  const sourceExternalId = "immutable-source-1";
  const originalContent =
    "Original synthetic content that must remain immutable.";
  const changedContent =
    "Changed synthetic content that must not replace the original.";

  try {
    const firstRun = await context.pipeline.run(
      new ManualImportCollector([
        {
          sourceType: "manual",
          sourceExternalId,
          title: "Original immutable source",
          author: "Synthetic User",
          content: originalContent,
          canonicalUrl:
            "https://example.test/manual/immutable-source-original",
          sourceMetadata: { synthetic: true },
        },
      ]),
    );
    assert.equal(firstRun.status, "succeeded");

    const duplicateRun = await context.pipeline.run(
      new ManualImportCollector([
        {
          sourceType: "manual",
          sourceExternalId,
          title: "Changed immutable source",
          author: "Changed Synthetic User",
          content: changedContent,
          canonicalUrl:
            "https://example.test/manual/immutable-source-changed",
          sourceMetadata: { synthetic: true, changed: true },
        },
      ]),
    );

    assert.equal(duplicateRun.status, "succeeded");
    assert.equal(duplicateRun.insertedCount, 0);
    assert.equal(duplicateRun.duplicateCount, 1);
    assert.equal(duplicateRun.processedCount, 0);
    assert.equal(countRows(context.database, "source_items"), 1);
    assert.equal(countRows(context.database, "analyses"), 1);

    const stored = context.database
      .prepare(`
        SELECT title, author, content, canonical_url
        FROM source_items
        WHERE source_type = ? AND source_external_id = ?
      `)
      .get("manual", sourceExternalId);
    assert.equal(stored?.["title"], "Original immutable source");
    assert.equal(stored?.["author"], "Synthetic User");
    assert.equal(stored?.["content"], originalContent);
    assert.equal(
      stored?.["canonical_url"],
      "https://example.test/manual/immutable-source-original",
    );
  } finally {
    context.database.close();
  }
});

class UnsafeRepositoryUrlLlmProvider extends FakeLlmProvider {
  constructor(private readonly unsafeUrl: string) {
    super();
  }

  override async analyze(item: SourceItem): Promise<unknown> {
    const output = await super.analyze(item);
    if (
      typeof output !== "object" ||
      output === null ||
      Array.isArray(output)
    ) {
      throw new TypeError("Fake LLM analysis must be an object");
    }

    return {
      ...output,
      relatedRepositories: [this.unsafeUrl],
    };
  }
}

test("analysis rejects HTTP and credential-bearing URLs with failed history", async () => {
  const cases = [
    {
      label: "HTTP",
      url: "http://github.com/synthetic/example",
      secret: "",
    },
    {
      label: "credentials",
      url: "https://synthetic-user:test-password@github.com/example/repo",
      secret: "test-password",
    },
  ] as const;

  for (const unsafeCase of cases) {
    const context = createTestContext(
      new UnsafeRepositoryUrlLlmProvider(unsafeCase.url),
    );

    try {
      let failedRunId = "";
      await assert.rejects(
        async () => {
          await context.pipeline.run(
            new ManualImportCollector([
              {
                sourceType: "manual",
                sourceExternalId: `unsafe-analysis-${unsafeCase.label}`,
                title: `Unsafe ${unsafeCase.label} analysis URL`,
                author: "Synthetic User",
                content:
                  "Synthetic content for unsafe analysis URL validation.",
                canonicalUrl:
                  `https://example.test/manual/unsafe-analysis-${unsafeCase.label}`,
                sourceMetadata: { synthetic: true },
              },
            ]),
          );
        },
        (error: unknown) => {
          assert.ok(error instanceof PipelineExecutionError);
          failedRunId = error.runId;
          return true;
        },
      );

      const failedRun =
        await context.processingRuns.findById(failedRunId);
      assert.equal(failedRun?.status, "failed");
      assert.equal(failedRun?.errorCode, "VALIDATION_ERROR");
      assert.equal(failedRun?.failedCount, 1);
      assert.equal(countRows(context.database, "analyses"), 0);
      assert.ok(
        context.logLines.every(
          (line) =>
            !line.includes(unsafeCase.url) &&
            (unsafeCase.secret === "" ||
              !line.includes(unsafeCase.secret)),
        ),
      );
    } finally {
      context.database.close();
    }
  }
});

class InvalidLlmProvider implements LlmProvider {
  readonly providerId = "invalid-local-fake";
  readonly modelId = "invalid-output";
  readonly promptVersion = "test";
  readonly schemaVersion = "test";

  async analyze(_item: SourceItem): Promise<unknown> {
    return { summary: "missing required fields" };
  }
}

test("invalid LLM schema fails safely and preserves processing history", async () => {
  const context = createTestContext(new InvalidLlmProvider());
  const input = [
    {
      sourceType: "manual",
      sourceExternalId: "invalid-analysis-1",
      title: "Invalid analysis fixture",
      author: "Synthetic User",
      content: "Synthetic content for invalid analysis output.",
      canonicalUrl: "https://example.test/manual/invalid-analysis-1",
      sourceMetadata: { synthetic: true },
    },
  ];

  try {
    let failedRunId = "";
    await assert.rejects(
      async () => {
        await context.pipeline.run(
          new ManualImportCollector(input),
        );
      },
      (error: unknown) => {
        assert.ok(error instanceof PipelineExecutionError);
        failedRunId = error.runId;
        return true;
      },
    );

    const failedRun = await context.processingRuns.findById(failedRunId);
    assert.equal(failedRun?.status, "failed");
    assert.equal(failedRun?.receivedCount, 1);
    assert.equal(failedRun?.insertedCount, 1);
    assert.equal(failedRun?.processedCount, 0);
    assert.equal(failedRun?.failedCount, 1);
    assert.equal(failedRun?.errorCode, "VALIDATION_ERROR");
    assert.equal(countRows(context.database, "processing_runs"), 1);
    assert.ok(
      context.logLines.every(
        (line) => !line.includes("missing required fields"),
      ),
    );

    const recoveryPipeline = new ResearchPipeline({
      repositories: {
        sourceItems: context.sourceItems,
        topicClusters: context.topicClusters,
        analyses: context.analyses,
        processingRuns: context.processingRuns,
      },
      llmProvider: new FakeLlmProvider(),
      logger: context.logger,
    });
    const recovered = await recoveryPipeline.run(
      new ManualImportCollector(input),
    );
    assert.equal(recovered.status, "succeeded");
    assert.equal(recovered.insertedCount, 0);
    assert.equal(recovered.duplicateCount, 1);
    assert.equal(recovered.processedCount, 1);
    assert.equal(countRows(context.database, "source_items"), 1);
    assert.equal(countRows(context.database, "analyses"), 1);
  } finally {
    context.database.close();
  }
});

class FailingCollector implements Collector {
  readonly sourceName = "synthetic-failing-collector";

  async collect(): Promise<CollectorResult> {
    const error = Object.assign(new Error("private collector detail"), {
      code: "COLLECTOR_DOWN",
    });
    throw error;
  }
}

test("collector failure is recorded without source content", async () => {
  const context = createTestContext();

  try {
    let failedRunId = "";
    await assert.rejects(
      async () => {
        await context.pipeline.run(new FailingCollector());
      },
      (error: unknown) => {
        assert.ok(error instanceof PipelineExecutionError);
        failedRunId = error.runId;
        return true;
      },
    );

    const run = await context.processingRuns.findById(failedRunId);
    assert.equal(run?.status, "failed");
    assert.equal(run?.receivedCount, 0);
    assert.equal(run?.insertedCount, 0);
    assert.equal(run?.failedCount, 1);
    assert.equal(run?.errorCode, "COLLECTOR_DOWN");
    assert.ok(
      context.logLines.every(
        (line) => !line.includes("private collector detail"),
      ),
    );
  } finally {
    context.database.close();
  }
});

class HostileErrorNameCollector implements Collector {
  readonly sourceName = "synthetic-hostile-error-name-collector";

  async collect(): Promise<CollectorResult> {
    const error = new Error("hostile-collector-private-detail");
    Object.defineProperty(error, "name", {
      configurable: true,
      get: () => {
        throw new Error("hostile-name-getter-private-detail");
      },
    });
    throw error;
  }
}

test("hostile Error.name getter still records a safe failed run", async () => {
  const context = createTestContext();

  try {
    let failedRunId = "";
    await assert.rejects(
      async () => {
        await context.pipeline.run(new HostileErrorNameCollector());
      },
      (error: unknown) => {
        assert.ok(error instanceof PipelineExecutionError);
        failedRunId = error.runId;
        return true;
      },
    );

    const run = await context.processingRuns.findById(failedRunId);
    assert.equal(run?.status, "failed");
    assert.equal(run?.failedCount, 1);
    assert.equal(run?.errorCode, undefined);
    assert.equal(run?.errorKind, "Error");
    assert.equal(countRows(context.database, "processing_runs"), 1);
    assert.ok(
      context.logLines.every(
        (line) =>
          !line.includes("hostile-collector-private-detail") &&
          !line.includes("hostile-name-getter-private-detail"),
      ),
    );
  } finally {
    context.database.close();
  }
});

test("X collector is an explicit non-networked configuration boundary", async () => {
  const collector = new XListTimelineCollector({ listId: "local-demo" });

  await assert.rejects(
    async () => collector.collect(),
    /x-list-timeline is not configured/u,
  );
});
