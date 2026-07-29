import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ContentDraftService } from "../src/features/rd-intelligence/application/content-draft-service.js";
import { DailyDigestService } from "../src/features/rd-intelligence/application/daily-digest-service.js";
import { ExperimentService } from "../src/features/rd-intelligence/application/experiment-service.js";
import { ResearchPipeline } from "../src/features/rd-intelligence/application/research-pipeline.js";
import { FixtureCollector } from "../src/features/rd-intelligence/collectors/fixture-collector.js";
import type { ProcessingRun } from "../src/features/rd-intelligence/domain/entities.js";
import { createLogger } from "../src/features/rd-intelligence/logging/logger.js";
import { FakeLlmProvider } from "../src/features/rd-intelligence/providers/fake-llm-provider.js";
import { SqliteContentDraftRepository } from "../src/features/rd-intelligence/storage/sqlite/content-draft-repository.js";
import { SqliteDailyDigestRepository } from "../src/features/rd-intelligence/storage/sqlite/daily-digest-repository.js";
import { SqliteExperimentRepository } from "../src/features/rd-intelligence/storage/sqlite/experiment-repository.js";
import { initializeDatabase } from "../src/features/rd-intelligence/storage/sqlite/initialize.js";
import {
  SqliteAnalysisRepository,
  SqliteProcessingRunRepository,
  SqliteSourceItemRepository,
  SqliteTopicClusterRepository,
} from "../src/features/rd-intelligence/storage/sqlite/pipeline-repositories.js";
import {
  asiaTokyoDayRange,
  asiaTokyoLocalDate,
} from "../src/features/rd-intelligence/validation/digest-parser.js";

const temporaryDirectories: string[] = [];

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function proposalInput(title: string) {
  return {
    title,
    hypothesis: "The fixture can validate a small local improvement.",
    expectedValue: "A repeatable decision.",
    smallestFirstStep: "Run one local fixture comparison.",
    requiredTools: ["Node.js", "SQLite"],
    estimatedEffort: "15 minutes",
    risk: "Fixture-only evidence is limited.",
    successCriteria: "One manual step is removed.",
    verificationMethod: "Compare recorded local runs.",
  };
}

function completionInput() {
  return {
    result: "One manual step was removed in the fixture.",
    verificationEvidence: "Two local run records were compared.",
    learned: "The narrow boundary reduced setup.",
    nextDecision: "Keep the local boundary.",
    hypothesisSupport: "supported" as const,
    reusableKnowledge: "Narrow fixture boundaries are easier to verify.",
    publishableFirstHandExperience:
      "I compared two fixture runs and observed one fewer manual step.",
  };
}

test("Asia/Tokyo date boundaries are deterministic around UTC rollover", () => {
  assert.equal(
    asiaTokyoLocalDate(
      undefined,
      new Date("2026-07-27T14:59:59.999Z"),
    ),
    "2026-07-27",
  );
  assert.equal(
    asiaTokyoLocalDate(
      undefined,
      new Date("2026-07-27T15:00:00.000Z"),
    ),
    "2026-07-28",
  );
  assert.deepEqual(asiaTokyoDayRange("2026-07-28"), {
    localDate: "2026-07-28",
    startAt: "2026-07-27T15:00:00.000Z",
    endAt: "2026-07-28T15:00:00.000Z",
    previousDayStartAt: "2026-07-26T15:00:00.000Z",
  });
  assert.throws(
    () => asiaTokyoDayRange("2026-02-30"),
    /localDate/u,
  );
});

test("manual digest aggregates insights, experiments, drafts, exclusions, and collector or LLM failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-rd-digest-"));
  temporaryDirectories.push(directory);
  const logger = createLogger(() => undefined);
  const initialized = initializeDatabase({
    databasePath: join(directory, "digest.sqlite"),
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
  const currentTime = () => new Date("2026-07-28T03:00:00.000Z");
  const pipeline = new ResearchPipeline({
    repositories: {
      sourceItems,
      topicClusters,
      analyses,
      processingRuns,
    },
    llmProvider: new FakeLlmProvider(),
    logger,
    now: currentTime,
  });

  try {
    await pipeline.run(
      new FixtureCollector(resolve("fixtures/source-items.json")),
    );
    const duplicateRun = await pipeline.run(
      new FixtureCollector(resolve("fixtures/source-items.json")),
    );
    assert.equal(duplicateRun.duplicateCount, 3);

    const ranked = await analyses.listRanked(10);
    const analysisIds = ranked.map(({ analysis }) => analysis.id);
    const firstAnalysisId = analysisIds[0];
    if (firstAnalysisId === undefined) {
      throw new Error("Expected fixture analyses");
    }
    initialized.database
      .prepare("UPDATE analyses SET confidence = 0.4 WHERE id = ?")
      .run(firstAnalysisId);

    const experiments = new SqliteExperimentRepository(
      initialized.database,
    );
    const currentExperiments = new ExperimentService({
      analyses,
      experiments,
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T04:00:00.000Z"),
    });
    const proposed = await currentExperiments.propose(
      firstAnalysisId,
      proposalInput("Try today"),
    );
    const active = await currentExperiments.propose(
      firstAnalysisId,
      proposalInput("Continue today"),
    );
    await currentExperiments.approve(active.id);

    const previousDayExperiments = new ExperimentService({
      analyses,
      experiments,
      processingRuns,
      logger,
      now: () => new Date("2026-07-27T03:00:00.000Z"),
    });
    const completedYesterday = await previousDayExperiments.propose(
      firstAnalysisId,
      proposalInput("Completed yesterday"),
    );
    await previousDayExperiments.approve(completedYesterday.id);
    await previousDayExperiments.start(completedYesterday.id);
    await previousDayExperiments.complete(
      completedYesterday.id,
      completionInput(),
    );

    const drafts = new SqliteContentDraftRepository(
      initialized.database,
    );
    const draftService = new ContentDraftService({
      analyses,
      sourceItems,
      experiments,
      drafts,
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T05:00:00.000Z"),
    });
    const draft = await draftService.generateX(firstAnalysisId);

    const failedRun: ProcessingRun = {
      id: "digest-fixture-failure",
      operation: "analyze",
      sourceOrProvider: "fixture|fake",
      status: "failed",
      receivedCount: 1,
      insertedCount: 0,
      duplicateCount: 0,
      processedCount: 0,
      failedCount: 1,
      retryCount: 1,
      errorCode: "PIPELINE_EXECUTION_FAILED",
      errorKind: "PipelineExecutionError",
      startedAt: "2026-07-27T15:10:00.000Z",
      finishedAt: "2026-07-27T15:10:01.000Z",
    };
    await processingRuns.save(failedRun);
    await processingRuns.save({
      ...failedRun,
      id: "excluded-draft-failure",
      operation: "draft",
      sourceOrProvider: "draft:edit",
    });

    const digestService = new DailyDigestService({
      dailyDigests: new SqliteDailyDigestRepository(
        initialized.database,
      ),
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T06:00:00.000Z"),
    });
    const digest = await digestService.generate("2026-07-28");

    assert.equal(digest.localDate, "2026-07-28");
    assert.equal(digest.timeZone, "Asia/Tokyo");
    assert.deepEqual(
      new Set(digest.topInsightIds),
      new Set(
        analysisIds.filter(
          (analysisId) => analysisId !== firstAnalysisId,
        ),
      ),
    );
    assert.ok(digest.proposedExperimentIds.includes(proposed.id));
    assert.ok(!digest.proposedExperimentIds.includes(completedYesterday.id));
    assert.ok(digest.activeExperimentIds.includes(active.id));
    assert.ok(
      digest.previousDayCompletedExperimentIds.includes(
        completedYesterday.id,
      ),
    );
    assert.ok(digest.draftCandidateIds.includes(draft.draft.id));
    assert.equal(digest.duplicateCount, 3);
    assert.equal(digest.lowConfidenceCount, 1);
    assert.equal(digest.processingFailureCount, 1);
    assert.equal(
      digest.generatedAt,
      "2026-07-28T06:00:00.000Z",
    );

    await assert.rejects(
      async () => digestService.generate("2026-02-30"),
      /localDate/u,
    );
    const digestRuns = (await processingRuns.list(200)).filter(
      (run) => run.operation === "digest",
    );
    assert.ok(digestRuns.some((run) => run.status === "succeeded"));
    assert.ok(
      digestRuns.some(
        (run) =>
          run.status === "failed" &&
          run.errorCode === "VALIDATION_ERROR",
      ),
    );
    assert.ok(
      digestRuns.every(
        (run) => run.sourceOrProvider === "digest:manual",
      ),
    );
  } finally {
    initialized.database.close();
  }
});
