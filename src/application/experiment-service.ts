import { randomUUID } from "node:crypto";
import type {
  Experiment,
  ExperimentEvent,
  ExperimentRun,
  Learning,
  ProcessingRun,
} from "../domain/entities.js";
import {
  canTransitionExperiment,
} from "../domain/experiment.js";
import type { ExperimentStatus } from "../domain/enums.js";
import type { Logger } from "../logging/logger.js";
import { safeErrorContext } from "../logging/logger.js";
import type {
  AnalysisRepository,
  ExperimentRepository,
  ProcessingRunRepository,
} from "../storage/repositories.js";
import {
  parseAnalysisId,
  parseCompleteExperimentInput,
  parseDecisionReason,
  parseExperimentId,
  parseProposeExperimentInput,
} from "../validation/experiment-parser.js";

export class SourceAnalysisNotFoundError extends Error {
  readonly code = "SOURCE_ANALYSIS_NOT_FOUND";

  constructor() {
    super("The source analysis does not exist");
    this.name = "SourceAnalysisNotFoundError";
  }
}

export class ExperimentNotFoundError extends Error {
  readonly code = "EXPERIMENT_NOT_FOUND";

  constructor() {
    super("The experiment does not exist");
    this.name = "ExperimentNotFoundError";
  }
}

export class ExperimentTransitionError extends Error {
  readonly code = "EXPERIMENT_INVALID_TRANSITION";

  constructor() {
    super("The requested experiment transition is not allowed");
    this.name = "ExperimentTransitionError";
  }
}

export class ExperimentConflictError extends Error {
  readonly code = "EXPERIMENT_CONFLICT";

  constructor() {
    super("The experiment changed during this operation");
    this.name = "ExperimentConflictError";
  }
}

export interface ExperimentDetail {
  readonly experiment: Experiment;
  readonly runs: readonly ExperimentRun[];
  readonly events: readonly ExperimentEvent[];
  readonly learning?: Learning;
}

export interface ExperimentServiceDependencies {
  readonly analyses: Pick<AnalysisRepository, "findById">;
  readonly experiments: ExperimentRepository;
  readonly processingRuns: ProcessingRunRepository;
  readonly logger: Logger;
  readonly id?: () => string;
  readonly now?: () => Date;
}

type ExperimentAction =
  | "propose"
  | "approve"
  | "start"
  | "complete"
  | "reject"
  | "block";

function monotonicTimestamp(previous: string, candidate: Date): string {
  const previousTime = Date.parse(previous);
  if (Number.isNaN(previousTime)) {
    throw new TypeError("Experiment has an invalid updated timestamp");
  }
  return new Date(
    Math.max(candidate.getTime(), previousTime + 1),
  ).toISOString();
}

function clearNextDecision(experiment: Experiment): Omit<
  Experiment,
  "nextDecision"
> {
  const { nextDecision: _nextDecision, ...remaining } = experiment;
  return remaining;
}

export class ExperimentService {
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(private readonly dependencies: ExperimentServiceDependencies) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async propose(
    sourceAnalysisIdValue: unknown,
    inputValue: unknown,
  ): Promise<Experiment> {
    return this.runMutation("propose", 1, async () => {
      const sourceAnalysisId = parseAnalysisId(sourceAnalysisIdValue);
      const input = parseProposeExperimentInput(inputValue);
      const analysis =
        await this.dependencies.analyses.findById(sourceAnalysisId);
      if (analysis === undefined) {
        throw new SourceAnalysisNotFoundError();
      }

      const createdAt = this.now().toISOString();
      const experiment: Experiment = {
        id: this.id(),
        sourceAnalysisId,
        title: input.title,
        hypothesis: input.hypothesis,
        expectedValue: input.expectedValue,
        smallestFirstStep: input.smallestFirstStep,
        requiredTools: input.requiredTools,
        estimatedEffort: input.estimatedEffort,
        risk: input.risk,
        successCriteria: input.successCriteria,
        verificationMethod: input.verificationMethod,
        status: "proposed",
        createdAt,
        updatedAt: createdAt,
      };
      const event: ExperimentEvent = {
        id: this.id(),
        experimentId: experiment.id,
        toStatus: "proposed",
        createdAt,
      };
      await this.dependencies.experiments.create(experiment, event);
      return experiment;
    });
  }

  async approve(experimentIdValue: unknown): Promise<Experiment> {
    return this.transition(
      experimentIdValue,
      "approved",
      "approve",
    );
  }

  async start(experimentIdValue: unknown): Promise<Experiment> {
    return this.transition(
      experimentIdValue,
      "in_progress",
      "start",
    );
  }

  async reject(
    experimentIdValue: unknown,
    reasonValue: unknown,
  ): Promise<Experiment> {
    return this.transition(
      experimentIdValue,
      "rejected",
      "reject",
      reasonValue,
      "rejectionReason",
    );
  }

  async block(
    experimentIdValue: unknown,
    reasonValue: unknown,
  ): Promise<Experiment> {
    return this.transition(
      experimentIdValue,
      "blocked",
      "block",
      reasonValue,
      "blockedReason",
    );
  }

  async complete(
    experimentIdValue: unknown,
    inputValue: unknown,
  ): Promise<ExperimentDetail> {
    return this.runMutation("complete", 0, async () => {
      const experimentId = parseExperimentId(experimentIdValue);
      const input = parseCompleteExperimentInput(inputValue);
      const current = await this.requireExperiment(experimentId);
      if (!canTransitionExperiment(current.status, "completed")) {
        throw new ExperimentTransitionError();
      }

      const completedAt = monotonicTimestamp(
        current.updatedAt,
        this.now(),
      );
      const experiment: Experiment = {
        ...clearNextDecision(current),
        status: "completed",
        result: input.result,
        learned: input.learned,
        nextDecision: input.nextDecision,
        updatedAt: completedAt,
      };
      const run: ExperimentRun = {
        id: this.id(),
        experimentId,
        sequence: 1,
        result: input.result,
        verificationEvidence: input.verificationEvidence,
        startedAt: current.updatedAt,
        completedAt,
      };
      const learning: Learning = {
        id: this.id(),
        experimentId,
        hypothesisSupport: input.hypothesisSupport,
        reusableKnowledge: input.reusableKnowledge,
        ...(input.nextExperiment === undefined
          ? {}
          : { nextExperiment: input.nextExperiment }),
        ...(input.publishableFirstHandExperience === undefined
          ? {}
          : {
              publishableFirstHandExperience:
                input.publishableFirstHandExperience,
            }),
        createdAt: completedAt,
      };
      const event: ExperimentEvent = {
        id: this.id(),
        experimentId,
        fromStatus: current.status,
        toStatus: "completed",
        createdAt: completedAt,
      };
      const saved = await this.dependencies.experiments.complete(
        experiment,
        current.updatedAt,
        run,
        learning,
        event,
      );
      if (!saved) throw new ExperimentConflictError();

      return {
        experiment,
        runs: [run],
        events: await this.dependencies.experiments.listEvents(
          experimentId,
        ),
        learning,
      };
    });
  }

  async getDetail(experimentIdValue: unknown): Promise<ExperimentDetail> {
    const experimentId = parseExperimentId(experimentIdValue);
    const experiment = await this.requireExperiment(experimentId);
    const [runs, events, learning] = await Promise.all([
      this.dependencies.experiments.listRuns(experimentId),
      this.dependencies.experiments.listEvents(experimentId),
      this.dependencies.experiments.findLearning(experimentId),
    ]);
    return {
      experiment,
      runs,
      events,
      ...(learning === undefined ? {} : { learning }),
    };
  }

  async list(): Promise<readonly Experiment[]> {
    return this.dependencies.experiments.list();
  }

  private async transition(
    experimentIdValue: unknown,
    toStatus: ExperimentStatus,
    action: ExperimentAction,
    reasonValue?: unknown,
    reasonField?: string,
  ): Promise<Experiment> {
    return this.runMutation(action, 0, async () => {
      const experimentId = parseExperimentId(experimentIdValue);
      const reason =
        reasonField === undefined
          ? undefined
          : parseDecisionReason(reasonValue, reasonField);
      const current = await this.requireExperiment(experimentId);
      if (!canTransitionExperiment(current.status, toStatus)) {
        throw new ExperimentTransitionError();
      }

      const updatedAt = monotonicTimestamp(
        current.updatedAt,
        this.now(),
      );
      const experiment: Experiment = {
        ...clearNextDecision(current),
        status: toStatus,
        ...(reason === undefined ? {} : { nextDecision: reason }),
        updatedAt,
      };
      const event: ExperimentEvent = {
        id: this.id(),
        experimentId,
        fromStatus: current.status,
        toStatus,
        ...(reason === undefined ? {} : { reason }),
        createdAt: updatedAt,
      };
      const saved = await this.dependencies.experiments.update(
        experiment,
        current.updatedAt,
        event,
      );
      if (!saved) throw new ExperimentConflictError();
      return experiment;
    });
  }

  private async requireExperiment(id: string): Promise<Experiment> {
    const experiment = await this.dependencies.experiments.findById(id);
    if (experiment === undefined) throw new ExperimentNotFoundError();
    return experiment;
  }

  private async runMutation<Result>(
    action: ExperimentAction,
    insertedCount: number,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const runId = this.id();
    const startedAt = this.now().toISOString();
    const running = this.processingRun({
      id: runId,
      action,
      status: "running",
      insertedCount: 0,
      processedCount: 0,
      failedCount: 0,
      startedAt,
    });
    await this.dependencies.processingRuns.save(running);
    this.logInfo("processing_run_started", runId);

    let result: Result;
    try {
      result = await work();
    } catch (error) {
      const safeError = safeErrorContext(error);
      const failed = this.processingRun({
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
      });
      await this.dependencies.processingRuns.save(failed);
      this.logError(runId, safeError);
      throw error;
    }

    const succeeded = this.processingRun({
      id: runId,
      action,
      status: "succeeded",
      insertedCount,
      processedCount: 1,
      failedCount: 0,
      startedAt,
      finishedAt: this.now().toISOString(),
    });
    await this.dependencies.processingRuns.save(succeeded);
    this.logInfo("processing_run_succeeded", runId);
    return result;
  }

  private processingRun(options: {
    readonly id: string;
    readonly action: ExperimentAction;
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
      operation: "experiment",
      sourceOrProvider: `experiment:${options.action}`,
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

  private logInfo(
    event: "processing_run_started" | "processing_run_succeeded",
    runId: string,
  ): void {
    try {
      this.dependencies.logger.info(event, {
        operation: "experiment",
        runId,
      });
    } catch {
      // Logging must not change the local experiment state.
    }
  }

  private logError(
    runId: string,
    context: ReturnType<typeof safeErrorContext>,
  ): void {
    try {
      this.dependencies.logger.error("processing_run_failed", {
        operation: "experiment",
        runId,
        ...context,
      });
    } catch {
      // Logging must not hide the original domain failure.
    }
  }
}
