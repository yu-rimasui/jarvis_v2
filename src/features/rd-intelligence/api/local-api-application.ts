import {
  DraftExperimentRequiredError,
  type ContentDraftService,
} from "../application/content-draft-service.js";
import type { DailyDigestService } from "../application/daily-digest-service.js";
import type { ExperimentService } from "../application/experiment-service.js";
import type { ResearchPipeline } from "../application/research-pipeline.js";
import type { PracticeWorkflowService } from "../application/practice-workflow-service.js";
import type { RssCollectionService } from "../application/rss-collection-service.js";
import { ManualImportCollector } from "../collectors/manual-import-collector.js";
import type {
  AnalysisRepository,
  ProcessingRunRepository,
  SourceItemRepository,
} from "../storage/repositories.js";
import { parseAnalysisId } from "../validation/experiment-parser.js";
import {
  parseRawSourceItems,
  ValidationError,
} from "../validation/source-item-parser.js";

export class InsightNotFoundError extends Error {
  readonly code = "INSIGHT_NOT_FOUND";

  constructor() {
    super("The ranked insight does not exist");
    this.name = "InsightNotFoundError";
  }
}

export class InsightSourceNotFoundError extends Error {
  readonly code = "INSIGHT_SOURCE_NOT_FOUND";

  constructor() {
    super("The source item for the ranked insight does not exist");
    this.name = "InsightSourceNotFoundError";
  }
}

export class LocalIntegrationUnavailableError extends Error {
  readonly code = "LOCAL_INTEGRATION_UNAVAILABLE";
}

export interface LocalApiApplicationDependencies {
  readonly pipeline: Pick<ResearchPipeline, "run">;
  readonly sourceItems: Pick<
    SourceItemRepository,
    "findById" | "list"
  >;
  readonly analyses: Pick<
    AnalysisRepository,
    "findRankedById" | "listRanked"
  >;
  readonly experiments: Pick<
    ExperimentService,
    | "approve"
    | "block"
    | "complete"
    | "getDetail"
    | "list"
    | "propose"
    | "reject"
    | "start"
  >;
  readonly drafts: Pick<
    ContentDraftService,
    | "approve"
    | "edit"
    | "generateX"
    | "getDetail"
    | "list"
    | "reject"
    | "submitForReview"
    | "reload"
  >;
  readonly processingRuns: Pick<ProcessingRunRepository, "list">;
  readonly digests: Pick<DailyDigestService, "generate">;
  readonly collections: Pick<RssCollectionService, "collect">;
  readonly practice?: Pick<PracticeWorkflowService, "start" | "importLog">;
  readonly readiness: () => Promise<unknown>;
}

export class LocalApiApplication {
  constructor(
    private readonly dependencies: LocalApiApplicationDependencies,
  ) {}

  async importInbox(itemsValue: unknown) {
    const items = parseRawSourceItems(itemsValue);
    return this.dependencies.pipeline.run(
      new ManualImportCollector(items),
    );
  }

  async readiness() {
    return this.dependencies.readiness();
  }

  async collectRss() {
    return this.dependencies.collections.collect();
  }

  async importX(inputValue: unknown) {
    if (
      typeof inputValue !== "object" ||
      inputValue === null ||
      Array.isArray(inputValue)
    ) {
      return this.importInbox(inputValue);
    }
    const input = inputValue as Readonly<Record<string, unknown>>;
    const canonicalUrl = input["canonicalUrl"];
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(typeof canonicalUrl === "string" ? canonicalUrl : "");
    } catch {
      throw new ValidationError(
        "request.canonicalUrl",
        "must be an X post URL",
      );
    }
    if (
      parsedUrl.protocol !== "https:" ||
      !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
        parsedUrl.hostname.toLocaleLowerCase("en-US"),
      ) ||
      !/^\/[^/]+\/status\/\d+/u.test(parsedUrl.pathname)
    ) {
      throw new ValidationError(
        "request.canonicalUrl",
        "must be an HTTPS X post URL",
      );
    }
    return this.importInbox([
      {
        ...input,
        sourceType: "x",
        title: input["title"] ?? "X投稿",
        sourceMetadata: {},
      },
    ]);
  }

  async startPractice(analysisIdValue: unknown) {
    if (this.dependencies.practice === undefined) {
      throw new LocalIntegrationUnavailableError();
    }
    return this.dependencies.practice.start(analysisIdValue);
  }

  async importPracticeLog(experimentIdValue: unknown) {
    if (this.dependencies.practice === undefined) {
      throw new LocalIntegrationUnavailableError();
    }
    return this.dependencies.practice.importLog(experimentIdValue);
  }

  async listInbox(limit: number) {
    return this.dependencies.sourceItems.list(limit);
  }

  async listInsights(limit: number) {
    return this.dependencies.analyses.listRanked(limit);
  }

  async getInsight(analysisIdValue: unknown) {
    const analysisId = parseAnalysisId(analysisIdValue);
    const ranked =
      await this.dependencies.analyses.findRankedById(analysisId);
    if (ranked === undefined) throw new InsightNotFoundError();

    const sourceItem = await this.dependencies.sourceItems.findById(
      ranked.analysis.sourceItemId,
    );
    if (sourceItem === undefined) {
      throw new InsightSourceNotFoundError();
    }
    return { ...ranked, sourceItem };
  }

  async proposeExperiment(
    analysisIdValue: unknown,
    inputValue: unknown,
  ) {
    return this.dependencies.experiments.propose(
      analysisIdValue,
      inputValue,
    );
  }

  async listExperiments() {
    return this.dependencies.experiments.list();
  }

  async getExperiment(experimentIdValue: unknown) {
    return this.dependencies.experiments.getDetail(experimentIdValue);
  }

  async approveExperiment(experimentIdValue: unknown) {
    return this.dependencies.experiments.approve(experimentIdValue);
  }

  async startExperiment(experimentIdValue: unknown) {
    return this.dependencies.experiments.start(experimentIdValue);
  }

  async rejectExperiment(
    experimentIdValue: unknown,
    reasonValue: unknown,
  ) {
    return this.dependencies.experiments.reject(
      experimentIdValue,
      reasonValue,
    );
  }

  async blockExperiment(
    experimentIdValue: unknown,
    reasonValue: unknown,
  ) {
    return this.dependencies.experiments.block(
      experimentIdValue,
      reasonValue,
    );
  }

  async completeExperiment(
    experimentIdValue: unknown,
    inputValue: unknown,
  ) {
    return this.dependencies.experiments.complete(
      experimentIdValue,
      inputValue,
    );
  }

  async generateXDraft(
    analysisIdValue: unknown,
    experimentIdValue?: unknown,
  ) {
    if (experimentIdValue === undefined) {
      throw new DraftExperimentRequiredError();
    }
    return this.dependencies.drafts.generateX(
      analysisIdValue,
      experimentIdValue,
    );
  }

  async listDrafts() {
    return this.dependencies.drafts.list();
  }

  async getDraft(draftIdValue: unknown) {
    return this.dependencies.drafts.getDetail(draftIdValue);
  }

  async reloadDraft(draftIdValue: unknown) {
    return this.dependencies.drafts.reload(draftIdValue);
  }

  async editDraft(draftIdValue: unknown, inputValue: unknown) {
    return this.dependencies.drafts.edit(draftIdValue, inputValue);
  }

  async submitDraftForReview(draftIdValue: unknown) {
    return this.dependencies.drafts.submitForReview(draftIdValue);
  }

  async approveDraft(draftIdValue: unknown) {
    return this.dependencies.drafts.approve(draftIdValue);
  }

  async rejectDraft(
    draftIdValue: unknown,
    reasonValue: unknown,
  ) {
    return this.dependencies.drafts.reject(
      draftIdValue,
      reasonValue,
    );
  }

  async listProcessingHistory(limit: number) {
    return this.dependencies.processingRuns.list(limit);
  }

  async generateDigest(localDateValue?: unknown) {
    return this.dependencies.digests.generate(localDateValue);
  }
}
