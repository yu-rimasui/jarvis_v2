import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ExperimentConflictError,
  ExperimentService,
  ExperimentTransitionError,
  SourceAnalysisNotFoundError,
} from "../src/features/rd-intelligence/application/experiment-service.js";
import { ResearchPipeline } from "../src/features/rd-intelligence/application/research-pipeline.js";
import { FixtureCollector } from "../src/features/rd-intelligence/collectors/fixture-collector.js";
import {
  allowedExperimentTransitions,
  canTransitionExperiment,
} from "../src/features/rd-intelligence/domain/experiment.js";
import {
  EXPERIMENT_STATUSES,
  type ExperimentStatus,
} from "../src/features/rd-intelligence/domain/enums.js";
import { createLogger } from "../src/features/rd-intelligence/logging/logger.js";
import { FakeLlmProvider } from "../src/features/rd-intelligence/providers/fake-llm-provider.js";
import { initializeDatabase } from "../src/features/rd-intelligence/storage/sqlite/initialize.js";
import { SqliteExperimentRepository } from "../src/features/rd-intelligence/storage/sqlite/experiment-repository.js";
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

function proposalInput() {
  return {
    title: "Synthetic MCP comparison",
    hypothesis:
      "A constrained MCP prototype will reduce setup work in the fixture flow.",
    expectedValue: "A repeatable local comparison and a go/no-go decision.",
    smallestFirstStep: "Build one local read-only tool with fixture data.",
    requiredTools: ["Node.js", "SQLite", "Node.js"],
    estimatedEffort: "30 minutes",
    risk: "The fixture may not represent production usage.",
    successCriteria:
      "The prototype completes the fixture task with fewer manual steps.",
    verificationMethod:
      "Compare completion, elapsed time, and observed errors with the baseline.",
  };
}

function completionInput(
  hypothesisSupport: "supported" | "not_supported",
) {
  const supported = hypothesisSupport === "supported";
  return {
    result: supported
      ? "The synthetic task completed with two fewer manual steps."
      : "The synthetic task failed at the same setup step as the baseline.",
    verificationEvidence: supported
      ? "Recorded both runs locally and compared the step counts."
      : "Captured the local error and reproduced it twice with fixture data.",
    learned: supported
      ? "The narrow tool boundary removed repeated setup work."
      : "The proposed tool boundary did not address the actual setup failure.",
    nextDecision: supported
      ? "Run the same comparison on one additional fixture."
      : "Reject this approach and test a smaller parser-only change.",
    hypothesisSupport,
    reusableKnowledge: supported
      ? "A read-only boundary can reduce repeated local setup."
      : "The setup failure occurs before the proposed MCP boundary.",
    nextExperiment: supported
      ? "Repeat with a second synthetic repository."
      : "Measure the parser-only baseline.",
    publishableFirstHandExperience: supported
      ? "I tested the local fixture twice and observed two fewer manual steps."
      : "I reproduced the same local setup failure twice with fixture data.",
  };
}

async function createContext() {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-rd-experiment-"));
  temporaryDirectories.push(directory);
  const logLines: string[] = [];
  const logger = createLogger((line) => {
    logLines.push(line);
  });
  const initialized = initializeDatabase({
    databasePath: join(directory, "experiment.sqlite"),
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
    llmProvider: new FakeLlmProvider(),
    logger,
  });
  await pipeline.run(
    new FixtureCollector(resolve("fixtures/source-items.json")),
  );
  const ranked = await analyses.listRanked(10);
  const firstAnalysis = ranked[0]?.analysis;
  if (firstAnalysis === undefined) {
    throw new Error("Expected a fixture analysis");
  }

  const experiments = new SqliteExperimentRepository(
    initialized.database,
  );
  const service = new ExperimentService({
    analyses,
    experiments,
    processingRuns,
    logger,
    now: () => new Date("2026-07-28T04:00:00.000Z"),
  });

  return {
    database: initialized.database,
    experiments,
    processingRuns,
    service,
    analysisId: firstAnalysis.id,
    logLines,
  };
}

test("experiment transition matrix requires approval and has terminal states", () => {
  const expected: Readonly<
    Record<ExperimentStatus, readonly ExperimentStatus[]>
  > = {
    proposed: ["approved", "rejected", "blocked"],
    approved: ["in_progress", "rejected", "blocked"],
    in_progress: ["completed", "rejected", "blocked"],
    blocked: ["approved", "rejected"],
    completed: [],
    rejected: [],
  };

  for (const from of EXPERIMENT_STATUSES) {
    assert.deepEqual(allowedExperimentTransitions(from), expected[from]);
    for (const to of EXPERIMENT_STATUSES) {
      assert.equal(
        canTransitionExperiment(from, to),
        expected[from].includes(to),
        `${from} -> ${to}`,
      );
    }
  }
  assert.equal(canTransitionExperiment("proposed", "in_progress"), false);
  assert.equal(canTransitionExperiment("blocked", "in_progress"), false);
});

test("failed experiment result and learning persist without auto execution", async () => {
  const context = await createContext();
  const privateResult = "private-local-result-marker";

  try {
    const proposed = await context.service.propose(
      context.analysisId,
      proposalInput(),
    );
    assert.equal(proposed.status, "proposed");
    assert.deepEqual(proposed.requiredTools, ["Node.js", "SQLite"]);

    await assert.rejects(
      async () => context.service.start(proposed.id),
      ExperimentTransitionError,
    );

    const approved = await context.service.approve(proposed.id);
    assert.equal(approved.status, "approved");
    const started = await context.service.start(proposed.id);
    assert.equal(started.status, "in_progress");

    await assert.rejects(
      async () =>
        context.service.complete(proposed.id, {
          ...completionInput("not_supported"),
          verificationEvidence: " ",
        }),
      /completion\.verificationEvidence/u,
    );
    assert.equal(
      (await context.service.getDetail(proposed.id)).experiment.status,
      "in_progress",
    );
    assert.equal(
      (await context.experiments.listRuns(proposed.id)).length,
      0,
    );

    const completed = await context.service.complete(proposed.id, {
      ...completionInput("not_supported"),
      result: `${privateResult}: the fixture reproduced the failure.`,
    });
    assert.equal(completed.experiment.status, "completed");
    assert.match(completed.experiment.result ?? "", /private-local-result/u);
    assert.equal(completed.runs.length, 1);
    assert.equal(completed.runs[0]?.sequence, 1);
    assert.match(
      completed.runs[0]?.verificationEvidence ?? "",
      /reproduced it twice/u,
    );
    assert.equal(
      completed.learning?.hypothesisSupport,
      "not_supported",
    );
    assert.match(
      completed.learning?.reusableKnowledge ?? "",
      /before the proposed MCP boundary/u,
    );
    assert.deepEqual(
      completed.events.map((event) => event.toStatus),
      ["proposed", "approved", "in_progress", "completed"],
    );

    await assert.rejects(
      async () =>
        context.service.block(
          proposed.id,
          "A completed experiment cannot be blocked.",
        ),
      ExperimentTransitionError,
    );

    const reloaded = await context.service.getDetail(proposed.id);
    assert.equal(reloaded.experiment.result, completed.experiment.result);
    assert.equal(reloaded.runs.length, 1);
    assert.equal(
      reloaded.learning?.publishableFirstHandExperience,
      "I reproduced the same local setup failure twice with fixture data.",
    );

    const history = (await context.processingRuns.list(50)).filter(
      (run) => run.operation === "experiment",
    );
    assert.ok(history.some((run) => run.status === "succeeded"));
    assert.ok(
      history.some(
        (run) =>
          run.status === "failed" &&
          run.errorCode === "EXPERIMENT_INVALID_TRANSITION",
      ),
    );
    assert.ok(
      history.some(
        (run) =>
          run.status === "failed" &&
          run.errorCode === "VALIDATION_ERROR",
      ),
    );
    assert.ok(
      context.logLines.every(
        (line) => !line.includes(privateResult),
      ),
    );
  } finally {
    context.database.close();
  }
});

test("successful learning and blocked or rejected decisions remain auditable", async () => {
  const context = await createContext();

  try {
    const successful = await context.service.propose(
      context.analysisId,
      {
        ...proposalInput(),
        title: "Successful synthetic experiment",
      },
    );
    await context.service.approve(successful.id);
    await context.service.start(successful.id);
    const completed = await context.service.complete(
      successful.id,
      completionInput("supported"),
    );
    assert.equal(completed.learning?.hypothesisSupport, "supported");

    const blocked = await context.service.propose(context.analysisId, {
      ...proposalInput(),
      title: "Blocked synthetic experiment",
    });
    await context.service.block(
      blocked.id,
      "Required local fixture is not available.",
    );
    await assert.rejects(
      async () => context.service.start(blocked.id),
      ExperimentTransitionError,
    );
    await context.service.approve(blocked.id);
    const blockedEvents = await context.experiments.listEvents(blocked.id);
    assert.deepEqual(
      blockedEvents.map((event) => event.toStatus),
      ["proposed", "blocked", "approved"],
    );
    assert.equal(
      blockedEvents.find((event) => event.toStatus === "blocked")?.reason,
      "Required local fixture is not available.",
    );

    const rejected = await context.service.propose(context.analysisId, {
      ...proposalInput(),
      title: "Rejected synthetic experiment",
    });
    await context.service.reject(
      rejected.id,
      "Expected value is too small for the effort.",
    );
    await assert.rejects(
      async () => context.service.approve(rejected.id),
      ExperimentTransitionError,
    );

    const list = await context.service.list();
    assert.equal(list.length, 3);
    assert.ok(list.some((experiment) => experiment.status === "completed"));
    assert.ok(list.some((experiment) => experiment.status === "approved"));
    assert.ok(list.some((experiment) => experiment.status === "rejected"));
  } finally {
    context.database.close();
  }
});

test("proposal requires an existing ranked insight and records failure history", async () => {
  const context = await createContext();

  try {
    await assert.rejects(
      async () =>
        context.service.propose(
          "missing-analysis",
          proposalInput(),
        ),
      SourceAnalysisNotFoundError,
    );

    const history = (await context.processingRuns.list(20)).filter(
      (run) => run.operation === "experiment",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0]?.status, "failed");
    assert.equal(history[0]?.errorCode, "SOURCE_ANALYSIS_NOT_FOUND");
    assert.equal(await context.service.list().then((items) => items.length), 0);
  } finally {
    context.database.close();
  }
});

test("concurrent approvals use optimistic concurrency and write one event", async () => {
  const context = await createContext();

  try {
    const proposed = await context.service.propose(
      context.analysisId,
      proposalInput(),
    );
    const outcomes = await Promise.allSettled([
      context.service.approve(proposed.id),
      context.service.approve(proposed.id),
    ]);

    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const rejected = outcomes.find(
      (outcome) => outcome.status === "rejected",
    );
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof ExperimentConflictError);

    const detail = await context.service.getDetail(proposed.id);
    assert.equal(detail.experiment.status, "approved");
    assert.deepEqual(
      detail.events.map((event) => event.toStatus),
      ["proposed", "approved"],
    );
    const history = (await context.processingRuns.list(20)).filter(
      (run) => run.operation === "experiment",
    );
    assert.ok(
      history.some(
        (run) =>
          run.status === "failed" &&
          run.errorCode === "EXPERIMENT_CONFLICT",
      ),
    );
  } finally {
    context.database.close();
  }
});
