import { randomUUID } from "node:crypto";
import {
  composedDraftText,
  type ContentRenderContext,
  type ContentRenderer,
  unicodeCharacterCount,
} from "../content/content-renderer.js";
import {
  matchesXEvidenceContext,
  XContentRenderer,
} from "../content/x-renderer.js";
import {
  canEditDraft,
  canTransitionDraft,
} from "../domain/content-draft.js";
import type {
  ContentDraft,
  ContentDraftEvent,
  ProcessingRun,
} from "../domain/entities.js";
import type { DraftStatus } from "../domain/enums.js";
import type { Logger } from "../logging/logger.js";
import { safeErrorContext } from "../logging/logger.js";
import type {
  AnalysisRepository,
  ContentDraftRepository,
  ExperimentRepository,
  ProcessingRunRepository,
  SourceItemRepository,
} from "../storage/repositories.js";
import {
  parseContentDraftId,
  parseDraftReviewReason,
  parseEditContentDraftInput,
  parseOptionalExperimentId,
} from "../validation/content-draft-parser.js";
import { parseAnalysisId } from "../validation/experiment-parser.js";

export class DraftAnalysisNotFoundError extends Error {
  readonly code = "DRAFT_ANALYSIS_NOT_FOUND";

  constructor() {
    super("The analysis for this draft does not exist");
    this.name = "DraftAnalysisNotFoundError";
  }
}

export class DraftSourceItemNotFoundError extends Error {
  readonly code = "DRAFT_SOURCE_NOT_FOUND";

  constructor() {
    super("The source item for this draft does not exist");
    this.name = "DraftSourceItemNotFoundError";
  }
}

export class DraftExperimentNotFoundError extends Error {
  readonly code = "DRAFT_EXPERIMENT_NOT_FOUND";

  constructor() {
    super("The experiment for this draft does not exist");
    this.name = "DraftExperimentNotFoundError";
  }
}

export class DraftExperimentMismatchError extends Error {
  readonly code = "DRAFT_EXPERIMENT_MISMATCH";

  constructor() {
    super("The experiment belongs to a different analysis");
    this.name = "DraftExperimentMismatchError";
  }
}

export class ContentDraftNotFoundError extends Error {
  readonly code = "CONTENT_DRAFT_NOT_FOUND";

  constructor() {
    super("The content draft does not exist");
    this.name = "ContentDraftNotFoundError";
  }
}

export class ContentDraftTransitionError extends Error {
  readonly code = "CONTENT_DRAFT_INVALID_TRANSITION";

  constructor() {
    super("The requested content draft transition is not allowed");
    this.name = "ContentDraftTransitionError";
  }
}

export class ContentDraftConflictError extends Error {
  readonly code = "CONTENT_DRAFT_CONFLICT";

  constructor() {
    super("The content draft changed during this operation");
    this.name = "ContentDraftConflictError";
  }
}

export class ContentDraftTooLongError extends Error {
  readonly code = "CONTENT_DRAFT_TOO_LONG";

  constructor() {
    super("The composed X draft exceeds 280 Unicode characters");
    this.name = "ContentDraftTooLongError";
  }
}

export class ContentDraftEvidenceViolationError extends Error {
  readonly code = "CONTENT_DRAFT_EVIDENCE_VIOLATION";

  constructor() {
    super("The rendered draft claims unsupported first-hand experience");
    this.name = "ContentDraftEvidenceViolationError";
  }
}

export class ContentDraftHistoryFinalizationError extends Error {
  readonly code = "CONTENT_DRAFT_HISTORY_FINALIZATION_FAILED";

  constructor() {
    super("The draft changed, but processing history could not be finalized");
    this.name = "ContentDraftHistoryFinalizationError";
  }
}

export interface ContentDraftDetail {
  readonly draft: ContentDraft;
  readonly events: readonly ContentDraftEvent[];
}

export interface ContentDraftServiceDependencies {
  readonly analyses: Pick<AnalysisRepository, "findById">;
  readonly sourceItems: Pick<SourceItemRepository, "findById">;
  readonly experiments: Pick<
    ExperimentRepository,
    "findById" | "findLearning"
  >;
  readonly drafts: ContentDraftRepository;
  readonly processingRuns: ProcessingRunRepository;
  readonly logger: Logger;
  readonly xRenderer?: ContentRenderer<"x">;
  readonly id?: () => string;
  readonly now?: () => Date;
}

type DraftAction =
  | "generate"
  | "edit"
  | "review"
  | "approve"
  | "reject"
  | "record_published";

function monotonicTimestamp(previous: string, candidate: Date): string {
  const previousTime = Date.parse(previous);
  if (Number.isNaN(previousTime)) {
    throw new TypeError("Content draft has an invalid updated timestamp");
  }
  return new Date(
    Math.max(candidate.getTime(), previousTime + 1),
  ).toISOString();
}

export class ContentDraftService {
  private readonly id: () => string;
  private readonly now: () => Date;
  private readonly xRenderer: ContentRenderer<"x">;

  constructor(private readonly dependencies: ContentDraftServiceDependencies) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
    this.xRenderer = dependencies.xRenderer ?? new XContentRenderer();
  }

  async generateX(
    analysisIdValue: unknown,
    experimentIdValue?: unknown,
  ): Promise<ContentDraftDetail> {
    return this.runMutation("generate", 1, async () => {
      const analysisId = parseAnalysisId(analysisIdValue);
      const experimentId =
        parseOptionalExperimentId(experimentIdValue);
      const analysis =
        await this.dependencies.analyses.findById(analysisId);
      if (analysis === undefined) throw new DraftAnalysisNotFoundError();
      const sourceItem =
        await this.dependencies.sourceItems.findById(
          analysis.sourceItemId,
        );
      if (sourceItem === undefined) {
        throw new DraftSourceItemNotFoundError();
      }

      const experiment =
        experimentId === undefined
          ? undefined
          : await this.dependencies.experiments.findById(experimentId);
      if (experimentId !== undefined && experiment === undefined) {
        throw new DraftExperimentNotFoundError();
      }
      if (
        experiment !== undefined &&
        experiment.sourceAnalysisId !== analysis.id
      ) {
        throw new DraftExperimentMismatchError();
      }
      const learning =
        experiment === undefined
          ? undefined
          : await this.dependencies.experiments.findLearning(
              experiment.id,
            );
      const renderContext = {
        analysis,
        sourceItem,
        ...(experiment === undefined ? {} : { experiment }),
        ...(learning === undefined ? {} : { learning }),
      };
      const rendered = this.xRenderer.render(renderContext);
      if (!matchesXEvidenceContext(renderContext, rendered)) {
        throw new ContentDraftEvidenceViolationError();
      }
      const characterCount = unicodeCharacterCount(
        composedDraftText(rendered),
      );
      if (characterCount > 280) {
        throw new ContentDraftTooLongError();
      }

      const generatedAt = this.now().toISOString();
      const draft: ContentDraft = {
        id: this.id(),
        platform: "x",
        relatedAnalysisId: analysis.id,
        ...(experiment === undefined
          ? {}
          : { relatedExperimentId: experiment.id }),
        hook: rendered.hook,
        body: rendered.body,
        keyTakeaway: rendered.keyTakeaway,
        sourceLinks: rendered.sourceLinks,
        characterCount,
        status: "draft",
        evidenceScope: rendered.evidenceScope,
        provenance: rendered.provenance,
        providerId: this.xRenderer.providerId,
        modelId: this.xRenderer.modelId,
        promptVersion: this.xRenderer.promptVersion,
        generatedAt,
        updatedAt: generatedAt,
      };
      const event: ContentDraftEvent = {
        id: this.id(),
        contentDraftId: draft.id,
        toStatus: "draft",
        createdAt: generatedAt,
      };
      await this.dependencies.drafts.create(draft, event);
      return { draft, events: [event] };
    });
  }

  async edit(
    draftIdValue: unknown,
    inputValue: unknown,
  ): Promise<ContentDraft> {
    return this.runMutation("edit", 0, async () => {
      const draftId = parseContentDraftId(draftIdValue);
      const input = parseEditContentDraftInput(inputValue);
      const current = await this.requireDraft(draftId);
      if (!canEditDraft(current.status)) {
        throw new ContentDraftTransitionError();
      }
      const characterCount = unicodeCharacterCount(
        composedDraftText(input),
      );
      if (current.platform === "x" && characterCount > 280) {
        throw new ContentDraftTooLongError();
      }

      const nextStatus =
        current.status === "approved"
          ? "needs_review"
          : current.status === "rejected"
            ? "draft"
            : current.status;
      if (
        nextStatus !== current.status &&
        !canTransitionDraft(current.status, nextStatus)
      ) {
        throw new ContentDraftTransitionError();
      }
      const updatedAt = monotonicTimestamp(
        current.updatedAt,
        this.now(),
      );
      const draft: ContentDraft = {
        ...current,
        hook: input.hook,
        body: input.body,
        keyTakeaway: input.keyTakeaway,
        sourceLinks: input.sourceLinks,
        characterCount,
        status: nextStatus,
        updatedAt,
      };
      await this.assertStoredEvidence(draft);
      const event: ContentDraftEvent = {
        id: this.id(),
        contentDraftId: draft.id,
        fromStatus: current.status,
        toStatus: nextStatus,
        reason: "edited",
        createdAt: updatedAt,
      };
      const saved = await this.dependencies.drafts.update(
        draft,
        current.updatedAt,
        event,
      );
      if (!saved) throw new ContentDraftConflictError();
      return draft;
    });
  }

  async submitForReview(draftIdValue: unknown): Promise<ContentDraft> {
    return this.transition(
      draftIdValue,
      "needs_review",
      "review",
    );
  }

  async approve(draftIdValue: unknown): Promise<ContentDraft> {
    return this.transition(draftIdValue, "approved", "approve");
  }

  async reject(
    draftIdValue: unknown,
    reasonValue: unknown,
  ): Promise<ContentDraft> {
    return this.transition(
      draftIdValue,
      "rejected",
      "reject",
      reasonValue,
      "rejectionReason",
    );
  }

  async recordPublished(draftIdValue: unknown): Promise<ContentDraft> {
    return this.transition(
      draftIdValue,
      "published",
      "record_published",
      "Publication was recorded manually; Jarvis did not publish it.",
    );
  }

  async getDetail(draftIdValue: unknown): Promise<ContentDraftDetail> {
    const draftId = parseContentDraftId(draftIdValue);
    const draft = await this.requireDraft(draftId);
    return {
      draft,
      events: await this.dependencies.drafts.listEvents(draftId),
    };
  }

  async list(): Promise<readonly ContentDraft[]> {
    return this.dependencies.drafts.list();
  }

  private async transition(
    draftIdValue: unknown,
    toStatus: DraftStatus,
    action: DraftAction,
    reasonValue?: unknown,
    reasonField?: string,
  ): Promise<ContentDraft> {
    return this.runMutation(action, 0, async () => {
      const draftId = parseContentDraftId(draftIdValue);
      const reason =
        reasonField === undefined
          ? typeof reasonValue === "string"
            ? reasonValue
            : undefined
          : parseDraftReviewReason(reasonValue, reasonField);
      const current = await this.requireDraft(draftId);
      if (!canTransitionDraft(current.status, toStatus)) {
        throw new ContentDraftTransitionError();
      }
      if (
        toStatus === "needs_review" ||
        toStatus === "approved" ||
        toStatus === "published"
      ) {
        await this.assertStoredEvidence(current);
      }
      const updatedAt = monotonicTimestamp(
        current.updatedAt,
        this.now(),
      );
      const draft: ContentDraft = {
        ...current,
        status: toStatus,
        updatedAt,
      };
      const event: ContentDraftEvent = {
        id: this.id(),
        contentDraftId: draft.id,
        fromStatus: current.status,
        toStatus,
        ...(reason === undefined ? {} : { reason }),
        createdAt: updatedAt,
      };
      const saved = await this.dependencies.drafts.update(
        draft,
        current.updatedAt,
        event,
      );
      if (!saved) throw new ContentDraftConflictError();
      return draft;
    });
  }

  private async requireDraft(id: string): Promise<ContentDraft> {
    const draft = await this.dependencies.drafts.findById(id);
    if (draft === undefined) throw new ContentDraftNotFoundError();
    return draft;
  }

  private async assertStoredEvidence(
    draft: ContentDraft,
  ): Promise<void> {
    if (draft.platform !== "x") {
      throw new ContentDraftEvidenceViolationError();
    }
    const analysis = await this.dependencies.analyses.findById(
      draft.relatedAnalysisId,
    );
    if (analysis === undefined) throw new DraftAnalysisNotFoundError();
    const sourceItem = await this.dependencies.sourceItems.findById(
      analysis.sourceItemId,
    );
    if (sourceItem === undefined) {
      throw new DraftSourceItemNotFoundError();
    }
    const experiment =
      draft.relatedExperimentId === undefined
        ? undefined
        : await this.dependencies.experiments.findById(
            draft.relatedExperimentId,
          );
    if (
      draft.relatedExperimentId !== undefined &&
      experiment === undefined
    ) {
      throw new DraftExperimentNotFoundError();
    }
    if (
      experiment !== undefined &&
      experiment.sourceAnalysisId !== analysis.id
    ) {
      throw new DraftExperimentMismatchError();
    }
    const learning =
      experiment === undefined
        ? undefined
        : await this.dependencies.experiments.findLearning(
            experiment.id,
          );
    const context: ContentRenderContext = {
      analysis,
      sourceItem,
      ...(experiment === undefined ? {} : { experiment }),
      ...(learning === undefined ? {} : { learning }),
    };
    if (
      !matchesXEvidenceContext(context, draft, true) ||
      draft.characterCount !==
        unicodeCharacterCount(composedDraftText(draft))
    ) {
      throw new ContentDraftEvidenceViolationError();
    }
  }

  private async runMutation<Result>(
    action: DraftAction,
    insertedCount: number,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const runId = this.id();
    const startedAt = this.now().toISOString();
    await this.dependencies.processingRuns.save(
      this.processingRun({
        id: runId,
        action,
        status: "running",
        insertedCount: 0,
        processedCount: 0,
        failedCount: 0,
        startedAt,
      }),
    );
    this.log("info", "processing_run_started", runId);

    let result: Result;
    try {
      result = await work();
    } catch (error) {
      const safeError = safeErrorContext(error);
      await this.dependencies.processingRuns.save(
        this.processingRun({
          id: runId,
          action,
          status: "failed",
          insertedCount: 0,
          processedCount: 0,
          failedCount: 1,
          startedAt,
          finishedAt: this.now().toISOString(),
          ...(safeError.errorCode === undefined
            ? {}
            : { errorCode: safeError.errorCode }),
          ...(safeError.errorKind === undefined
            ? {}
            : { errorKind: safeError.errorKind }),
        }),
      );
      this.log(
        "error",
        "processing_run_failed",
        runId,
        safeError,
      );
      throw error;
    }

    try {
      await this.dependencies.processingRuns.save(
        this.processingRun({
          id: runId,
          action,
          status: "succeeded",
          insertedCount,
          processedCount: 1,
          failedCount: 0,
          startedAt,
          finishedAt: this.now().toISOString(),
        }),
      );
    } catch {
      const finalizationError =
        new ContentDraftHistoryFinalizationError();
      const safeError = safeErrorContext(finalizationError);
      try {
        await this.dependencies.processingRuns.save(
          this.processingRun({
            id: runId,
            action,
            status: "failed",
            insertedCount,
            processedCount: 1,
            failedCount: 1,
            startedAt,
            finishedAt: this.now().toISOString(),
            errorCode: finalizationError.code,
            errorKind: finalizationError.name,
          }),
        );
      } catch {
        // The draft is already committed. Preserve the explicit
        // finalization error if processing history storage is unavailable.
      }
      this.log(
        "error",
        "processing_run_failed",
        runId,
        safeError,
      );
      throw finalizationError;
    }
    this.log("info", "processing_run_succeeded", runId);
    return result;
  }

  private processingRun(options: {
    readonly id: string;
    readonly action: DraftAction;
    readonly status: ProcessingRun["status"];
    readonly insertedCount: number;
    readonly processedCount: number;
    readonly failedCount: number;
    readonly startedAt: string;
    readonly finishedAt?: string;
    readonly errorCode?: string;
    readonly errorKind?: string;
  }): ProcessingRun {
    return {
      id: options.id,
      operation: "draft",
      sourceOrProvider: `draft:${options.action}`,
      status: options.status,
      receivedCount: 1,
      insertedCount: options.insertedCount,
      duplicateCount: 0,
      processedCount: options.processedCount,
      failedCount: options.failedCount,
      retryCount: 0,
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

  private log(
    level: "info" | "error",
    event:
      | "processing_run_started"
      | "processing_run_succeeded"
      | "processing_run_failed",
    runId: string,
    context: ReturnType<typeof safeErrorContext> = {},
  ): void {
    try {
      this.dependencies.logger[level](event, {
        operation: "draft",
        runId,
        ...context,
      });
    } catch {
      // Logging must not change a local draft or hide the original error.
    }
  }
}
