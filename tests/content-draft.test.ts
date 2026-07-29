import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ContentDraftConflictError,
  ContentDraftEvidenceViolationError,
  ContentDraftHistoryFinalizationError,
  ContentDraftService,
  ContentDraftTooLongError,
  ContentDraftTransitionError,
  DraftExperimentMismatchError,
} from "../src/features/rd-intelligence/application/content-draft-service.js";
import { ExperimentService } from "../src/features/rd-intelligence/application/experiment-service.js";
import { ResearchPipeline } from "../src/features/rd-intelligence/application/research-pipeline.js";
import { FixtureCollector } from "../src/features/rd-intelligence/collectors/fixture-collector.js";
import {
  composedDraftText,
  type ContentRenderer,
  unicodeCharacterCount,
} from "../src/features/rd-intelligence/content/content-renderer.js";
import {
  allowedDraftTransitions,
  canTransitionDraft,
} from "../src/features/rd-intelligence/domain/content-draft.js";
import {
  DRAFT_STATUSES,
  type DraftStatus,
} from "../src/features/rd-intelligence/domain/enums.js";
import { createLogger } from "../src/features/rd-intelligence/logging/logger.js";
import { FakeLlmProvider } from "../src/features/rd-intelligence/providers/fake-llm-provider.js";
import type { ProcessingRunRepository } from "../src/features/rd-intelligence/storage/repositories.js";
import { SqliteContentDraftRepository } from "../src/features/rd-intelligence/storage/sqlite/content-draft-repository.js";
import { SqliteExperimentRepository } from "../src/features/rd-intelligence/storage/sqlite/experiment-repository.js";
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

function proposalInput(title: string) {
  return {
    title,
    hypothesis: "A local fixture experiment may reduce setup work.",
    expectedValue: "A repeatable local decision.",
    smallestFirstStep: "Compare one fixture run with the baseline.",
    requiredTools: ["Node.js", "SQLite"],
    estimatedEffort: "20 minutes",
    risk: "The fixture may not represent production.",
    successCriteria: "The fixture run removes one manual step.",
    verificationMethod: "Record and compare both local runs.",
  };
}

function completionInput(
  publishableFirstHandExperience?: string,
) {
  return {
    result: "The fixture run removed one manual step.",
    verificationEvidence: "Both local runs were recorded and compared.",
    learned: "The narrower input reduced repeated setup.",
    nextDecision: "Repeat with another fixture.",
    hypothesisSupport: "supported" as const,
    reusableKnowledge: "A narrow fixture boundary is reusable.",
    ...(publishableFirstHandExperience === undefined
      ? {}
      : { publishableFirstHandExperience }),
  };
}

async function createContext() {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-rd-draft-"));
  temporaryDirectories.push(directory);
  const logLines: string[] = [];
  const logger = createLogger((line) => {
    logLines.push(line);
  });
  const initialized = initializeDatabase({
    databasePath: join(directory, "draft.sqlite"),
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
    now: () => new Date("2026-07-28T03:00:00.000Z"),
  });
  await pipeline.run(
    new FixtureCollector(resolve("fixtures/source-items.json")),
  );
  const ranked = await analyses.listRanked(10);
  const analysisIds = ranked.map(({ analysis }) => analysis.id);
  if (analysisIds.length < 2) {
    throw new Error("Expected at least two fixture analyses");
  }

  const experiments = new SqliteExperimentRepository(
    initialized.database,
  );
  const experimentService = new ExperimentService({
    analyses,
    experiments,
    processingRuns,
    logger,
    now: () => new Date("2026-07-28T04:00:00.000Z"),
  });
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

  return {
    database: initialized.database,
    analysisIds,
    analyses,
    sourceItems,
    experiments,
    experimentService,
    drafts,
    draftService,
    processingRuns,
    logLines,
  };
}

test("content draft transitions require human review before publication", () => {
  const expected: Readonly<
    Record<DraftStatus, readonly DraftStatus[]>
  > = {
    draft: ["needs_review", "rejected"],
    needs_review: ["approved", "rejected"],
    approved: ["needs_review", "published", "rejected"],
    rejected: ["draft"],
    published: [],
  };

  for (const from of DRAFT_STATUSES) {
    assert.deepEqual(allowedDraftTransitions(from), expected[from]);
    for (const to of DRAFT_STATUSES) {
      assert.equal(
        canTransitionDraft(from, to),
        expected[from].includes(to),
        `${from} -> ${to}`,
      );
    }
  }
  assert.equal(canTransitionDraft("draft", "published"), false);
});

test("unfinished and unpublishable experiments never become experience claims", async () => {
  const context = await createContext();

  try {
    const sourceOnly = await context.draftService.generateX(
      context.analysisIds[0],
    );
    assert.equal(sourceOnly.draft.evidenceScope, "source_only");
    assert.match(sourceOnly.draft.body, /未検証/u);
    assert.doesNotMatch(sourceOnly.draft.body, /実際に試した/u);
    assert.ok(
      sourceOnly.draft.provenance.every(
        (item) => item.kind !== "EXPERIENCE",
      ),
    );

    const proposed = await context.experimentService.propose(
      context.analysisIds[0],
      proposalInput("Pending fixture experiment"),
    );
    const pending = await context.draftService.generateX(
      context.analysisIds[0],
      proposed.id,
    );
    assert.equal(pending.draft.evidenceScope, "source_only");
    assert.match(pending.draft.body, /実験はproposed。結果確定前/u);
    assert.doesNotMatch(pending.draft.body, /実際に試した/u);

    await context.experimentService.approve(proposed.id);
    await context.experimentService.start(proposed.id);
    await context.experimentService.complete(
      proposed.id,
      completionInput(),
    );
    const completedWithoutPublishableEvidence =
      await context.draftService.generateX(
        context.analysisIds[0],
        proposed.id,
      );
    assert.equal(
      completedWithoutPublishableEvidence.draft.evidenceScope,
      "source_only",
    );
    assert.match(
      completedWithoutPublishableEvidence.draft.body,
      /公開可能な体験記録は未登録/u,
    );
    assert.doesNotMatch(
      completedWithoutPublishableEvidence.draft.body,
      /実際に試した/u,
    );
  } finally {
    context.database.close();
  }
});

test("completed experiment evidence produces a bounded, traceable X draft", async () => {
  const context = await createContext();

  try {
    const experiment = await context.experimentService.propose(
      context.analysisIds[0],
      proposalInput("Completed fixture experiment"),
    );
    await context.experimentService.approve(experiment.id);
    await context.experimentService.start(experiment.id);
    const experience =
      "ローカルfixtureを比較し、手作業が1つ減ることを確認した。";
    await context.experimentService.complete(
      experiment.id,
      completionInput(experience),
    );

    const detail = await context.draftService.generateX(
      context.analysisIds[0],
      experiment.id,
    );
    assert.equal(detail.draft.evidenceScope, "completed_experiment");
    assert.match(detail.draft.body, /実際に試した/u);
    assert.match(detail.draft.body, /結果:/u);
    assert.ok(
      detail.draft.provenance.some(
        (item) =>
          item.kind === "EXPERIENCE" && item.text === experience,
      ),
    );
    assert.ok(
      detail.draft.provenance.some(
        (item) =>
          item.kind === "EXPERIMENT_RESULT" &&
          item.text === "The fixture run removed one manual step.",
      ),
    );
    assert.equal(
      detail.draft.characterCount,
      unicodeCharacterCount(composedDraftText(detail.draft)),
    );
    assert.ok(detail.draft.characterCount <= 280);
    assert.equal(detail.draft.platform, "x");
    assert.equal(detail.draft.providerId, "local-rules");
    assert.equal(detail.draft.modelId, "deterministic-x-renderer-v1");
    assert.equal(detail.draft.promptVersion, "x-draft-v1");
    assert.equal(detail.events.length, 1);
  } finally {
    context.database.close();
  }
});

test("editing reopens review and publication is only recorded after approval", async () => {
  const context = await createContext();
  const privateDraftText = "private-draft-text-marker";

  try {
    const generated = await context.draftService.generateX(
      context.analysisIds[0],
    );
    await assert.rejects(
      async () =>
        context.draftService.edit(generated.draft.id, {
          hook: "検証候補: 体験談へ変更",
          body: [
            `出典要約: ${privateDraftText}`,
            "Jarvis解釈: 実務に使える",
            "実際に試した: 未実施の実験に成功した",
          ].join("\n"),
          keyTakeaway: "次の一歩: 公開する",
          sourceLinks: generated.draft.sourceLinks,
        }),
      ContentDraftEvidenceViolationError,
    );
    await assert.rejects(
      async () =>
        context.draftService.edit(generated.draft.id, {
          hook: "検証候補: 実際に試して成功した",
          body: generated.draft.body,
          keyTakeaway: "次の一歩: 実際に試して成功した",
          sourceLinks: generated.draft.sourceLinks,
        }),
      ContentDraftEvidenceViolationError,
    );
    await assert.rejects(
      async () => context.draftService.recordPublished(generated.draft.id),
      ContentDraftTransitionError,
    );

    const review = await context.draftService.submitForReview(
      generated.draft.id,
    );
    assert.equal(review.status, "needs_review");
    const approved = await context.draftService.approve(
      generated.draft.id,
    );
    assert.equal(approved.status, "approved");
    const edited = await context.draftService.edit(
      generated.draft.id,
      {
        hook: approved.hook,
        body: approved.body,
        keyTakeaway: approved.keyTakeaway,
        sourceLinks: approved.sourceLinks.slice(0, 1),
      },
    );
    assert.equal(edited.status, "needs_review");
    assert.equal(
      edited.characterCount,
      unicodeCharacterCount(composedDraftText(edited)),
    );

    await context.draftService.approve(generated.draft.id);
    const published = await context.draftService.recordPublished(
      generated.draft.id,
    );
    assert.equal(published.status, "published");
    await assert.rejects(
      async () =>
        context.draftService.edit(generated.draft.id, {
          hook: "再編集",
          body: "公開後は編集できない",
          keyTakeaway: "不可",
          sourceLinks: [],
        }),
      ContentDraftTransitionError,
    );

    const reloaded = await context.draftService.getDetail(
      generated.draft.id,
    );
    assert.deepEqual(
      reloaded.events.map((event) => event.toStatus),
      [
        "draft",
        "needs_review",
        "approved",
        "needs_review",
        "approved",
        "published",
      ],
    );
    assert.match(
      reloaded.events.at(-1)?.reason ?? "",
      /Jarvis did not publish/u,
    );
    assert.ok(
      context.logLines.every(
        (line) => !line.includes(privateDraftText),
      ),
    );
  } finally {
    context.database.close();
  }
});

test("invalid draft mutations fail safely and preserve processing history", async () => {
  const context = await createContext();

  try {
    const generated = await context.draftService.generateX(
      context.analysisIds[0],
    );
    await assert.rejects(
      async () =>
        context.draftService.edit(generated.draft.id, {
          hook: "x".repeat(281),
          body: "body",
          keyTakeaway: "takeaway",
          sourceLinks: [],
        }),
      ContentDraftTooLongError,
    );
    const unchanged = await context.draftService.getDetail(
      generated.draft.id,
    );
    assert.equal(unchanged.draft.hook, generated.draft.hook);

    const foreignExperiment =
      await context.experimentService.propose(
        context.analysisIds[1],
        proposalInput("Foreign insight experiment"),
      );
    await assert.rejects(
      async () =>
        context.draftService.generateX(
          context.analysisIds[0],
          foreignExperiment.id,
        ),
      DraftExperimentMismatchError,
    );

    const failures = (
      await context.processingRuns.list(100)
    ).filter(
      (run) => run.operation === "draft" && run.status === "failed",
    );
    assert.ok(
      failures.some(
        (run) => run.errorCode === "CONTENT_DRAFT_TOO_LONG",
      ),
    );
    assert.ok(
      failures.some(
        (run) => run.errorCode === "DRAFT_EXPERIMENT_MISMATCH",
      ),
    );
  } finally {
    context.database.close();
  }
});

test("service rejects a renderer that invents first-hand evidence", async () => {
  const context = await createContext();
  const dishonestRenderer: ContentRenderer<"x"> = {
    platform: "x",
    providerId: "test-only",
    modelId: "dishonest-renderer",
    promptVersion: "test-v1",
    render: () => ({
      hook: "Unsupported experience",
      body: "実際に試した: まだ実行していない実験",
      keyTakeaway: "Unsupported",
      sourceLinks: [],
      characterCount: 60,
      evidenceScope: "completed_experiment",
      provenance: [
        {
          kind: "EXPERIENCE",
          text: "This never happened.",
        },
      ],
    }),
  };
  const guardedService = new ContentDraftService({
    analyses: context.analyses,
    sourceItems: context.sourceItems,
    experiments: context.experiments,
    drafts: context.drafts,
    processingRuns: context.processingRuns,
    logger: createLogger(() => undefined),
    xRenderer: dishonestRenderer,
    now: () => new Date("2026-07-28T06:00:00.000Z"),
  });

  try {
    await assert.rejects(
      async () => guardedService.generateX(context.analysisIds[0]),
      ContentDraftEvidenceViolationError,
    );
    assert.equal((await context.drafts.list()).length, 0);
    assert.ok(
      (await context.processingRuns.list(100)).some(
        (run) =>
          run.operation === "draft" &&
          run.status === "failed" &&
          run.errorCode === "CONTENT_DRAFT_EVIDENCE_VIOLATION",
      ),
    );
  } finally {
    context.database.close();
  }
});

test("concurrent review submissions write one status event", async () => {
  const context = await createContext();

  try {
    const generated = await context.draftService.generateX(
      context.analysisIds[0],
    );
    const outcomes = await Promise.allSettled([
      context.draftService.submitForReview(generated.draft.id),
      context.draftService.submitForReview(generated.draft.id),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled")
        .length,
      1,
    );
    const rejected = outcomes.find(
      (outcome) => outcome.status === "rejected",
    );
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof ContentDraftConflictError);

    const detail = await context.draftService.getDetail(
      generated.draft.id,
    );
    assert.equal(detail.draft.status, "needs_review");
    assert.deepEqual(
      detail.events.map((event) => event.toStatus),
      ["draft", "needs_review"],
    );
  } finally {
    context.database.close();
  }
});

test("approval revalidates persisted evidence instead of trusting metadata", async () => {
  const context = await createContext();

  try {
    const generated = await context.draftService.generateX(
      context.analysisIds[0],
    );
    await context.draftService.submitForReview(generated.draft.id);
    context.database
      .prepare("UPDATE content_drafts SET body = ? WHERE id = ?")
      .run(
        "実際に試した: 未実施の実験が成功した",
        generated.draft.id,
      );

    await assert.rejects(
      async () => context.draftService.approve(generated.draft.id),
      ContentDraftEvidenceViolationError,
    );
    const detail = await context.draftService.getDetail(
      generated.draft.id,
    );
    assert.equal(detail.draft.status, "needs_review");
    assert.deepEqual(
      detail.events.map((event) => event.toStatus),
      ["draft", "needs_review"],
    );
  } finally {
    context.database.close();
  }
});

test("history finalization failure is explicit after a committed draft", async () => {
  const context = await createContext();
  let rejectedSuccess = false;
  const processingRuns: ProcessingRunRepository = {
    save: async (run) => {
      if (
        run.operation === "draft" &&
        run.status === "succeeded" &&
        !rejectedSuccess
      ) {
        rejectedSuccess = true;
        throw new Error("Synthetic processing history failure");
      }
      await context.processingRuns.save(run);
    },
    findById: async (id) => context.processingRuns.findById(id),
    list: async (limit) => context.processingRuns.list(limit),
  };
  const service = new ContentDraftService({
    analyses: context.analyses,
    sourceItems: context.sourceItems,
    experiments: context.experiments,
    drafts: context.drafts,
    processingRuns,
    logger: createLogger(() => undefined),
    now: () => new Date("2026-07-28T07:00:00.000Z"),
  });

  try {
    await assert.rejects(
      async () => service.generateX(context.analysisIds[0]),
      ContentDraftHistoryFinalizationError,
    );
    assert.equal((await context.drafts.list()).length, 1);
    assert.ok(
      (await context.processingRuns.list(100)).some(
        (run) =>
          run.operation === "draft" &&
          run.status === "failed" &&
          run.processedCount === 1 &&
          run.errorCode ===
            "CONTENT_DRAFT_HISTORY_FINALIZATION_FAILED",
      ),
    );
  } finally {
    context.database.close();
  }
});
