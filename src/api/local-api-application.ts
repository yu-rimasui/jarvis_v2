import type {
  ContentDraftService,
} from "../application/content-draft-service.js";
import type { DailyDigestService } from "../application/daily-digest-service.js";
import type { ExperimentService } from "../application/experiment-service.js";
import type { ResearchPipeline } from "../application/research-pipeline.js";
import { ManualImportCollector } from "../collectors/manual-import-collector.js";
import type {
  AnalysisRepository,
  ProcessingRunRepository,
  SourceItemRepository,
} from "../storage/repositories.js";
import { parseAnalysisId } from "../validation/experiment-parser.js";
import { parseRawSourceItems } from "../validation/source-item-parser.js";

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
  >;
  readonly processingRuns: Pick<ProcessingRunRepository, "list">;
  readonly digests: Pick<DailyDigestService, "generate">;
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
