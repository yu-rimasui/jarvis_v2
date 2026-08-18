import type { ExperimentService } from "./experiment-service.js";
import type { KnowledgeVault } from "../vault/knowledge-vault.js";
import type {
  AnalysisRepository,
  ExperimentRepository,
  SourceItemRepository,
} from "../storage/repositories.js";
import {
  parseAnalysisId,
  parseExperimentId,
} from "../validation/experiment-parser.js";

export class PracticeAnalysisNotFoundError extends Error {
  readonly code = "PRACTICE_ANALYSIS_NOT_FOUND";
}

export class PracticeSourceNotFoundError extends Error {
  readonly code = "PRACTICE_SOURCE_NOT_FOUND";
}

export class PracticeExperimentNotFoundError extends Error {
  readonly code = "PRACTICE_EXPERIMENT_NOT_FOUND";
}

export class PracticeExperimentStateError extends Error {
  readonly code = "PRACTICE_EXPERIMENT_INVALID_STATE";
}

export interface PracticeWorkflowDependencies {
  readonly analyses: Pick<AnalysisRepository, "findById">;
  readonly sourceItems: Pick<SourceItemRepository, "findById">;
  readonly experimentRepository: Pick<
    ExperimentRepository,
    "findActiveByAnalysisId" | "findById"
  >;
  readonly experiments: Pick<
    ExperimentService,
    "approve" | "complete" | "propose" | "start"
  >;
  readonly vault: KnowledgeVault;
}

export class PracticeWorkflowService {
  constructor(
    private readonly dependencies: PracticeWorkflowDependencies,
  ) {}

  async start(analysisIdValue: unknown) {
    const analysisId = parseAnalysisId(analysisIdValue);
    const analysis =
      await this.dependencies.analyses.findById(analysisId);
    if (analysis === undefined) throw new PracticeAnalysisNotFoundError();
    const source = await this.dependencies.sourceItems.findById(
      analysis.sourceItemId,
    );
    if (source === undefined) throw new PracticeSourceNotFoundError();

    let experiment =
      await this.dependencies.experimentRepository.findActiveByAnalysisId(
        analysis.id,
      );
    if (experiment === undefined) {
      experiment = await this.dependencies.experiments.propose(analysis.id, {
        title: `${source.title}を最小構成で試す`,
        hypothesis: analysis.hypothesis,
        expectedValue: analysis.expectedValue,
        smallestFirstStep: analysis.suggestedFirstExperiment,
        requiredTools: analysis.requiredEnvironment,
        estimatedEffort: analysis.estimatedEffort,
        risk: analysis.risksAndLimitations.join(" / ") || "未特定",
        successCriteria: analysis.successCriteria,
        verificationMethod: analysis.verificationMethod,
      });
    }
    if (experiment.status === "proposed") {
      experiment = await this.dependencies.experiments.approve(experiment.id);
    }
    if (experiment.status === "approved") {
      experiment = await this.dependencies.experiments.start(experiment.id);
    }
    if (experiment.status !== "in_progress") {
      throw new PracticeExperimentStateError();
    }

    await this.dependencies.vault.saveInput(source, analysis);
    const note = await this.dependencies.vault.createPractice(
      source,
      analysis,
      experiment,
    );
    return { experiment, note: { relativePath: note.relativePath } };
  }

  async importLog(experimentIdValue: unknown) {
    const experimentId = parseExperimentId(experimentIdValue);
    const experiment =
      await this.dependencies.experimentRepository.findById(
        experimentId,
      );
    if (experiment === undefined) throw new PracticeExperimentNotFoundError();
    if (experiment.status !== "in_progress") throw new PracticeExperimentStateError();
    const imported = await this.dependencies.vault.readPractice(experiment.id);
    const evidence = imported.evidence;
    return this.dependencies.experiments.complete(experiment.id, {
      result: evidence.result,
      verificationEvidence: [
        `環境: ${evidence.environment}`,
        `操作: ${evidence.actions}`,
        `画像: ${String(evidence.images.length)}件`,
      ].join("\n"),
      learned: evidence.learning,
      nextDecision:
        evidence.errors === "なし"
          ? "知見を投稿下書きに反映する"
          : "詰まりを解消して再検証する",
      hypothesisSupport: imported.hypothesisSupport,
      reusableKnowledge: evidence.learning,
      publishableFirstHandExperience: evidence.publishableExperience,
    });
  }
}
