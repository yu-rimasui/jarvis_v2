import { randomUUID } from "node:crypto";
import type {
  DailyDigest,
  ProcessingRun,
} from "../domain/entities.js";
import type { Logger } from "../logging/logger.js";
import { safeErrorContext } from "../logging/logger.js";
import type {
  DailyDigestRepository,
  ProcessingRunRepository,
} from "../storage/repositories.js";
import {
  asiaTokyoDayRange,
  asiaTokyoLocalDate,
} from "../validation/digest-parser.js";

export interface DailyDigestServiceDependencies {
  readonly dailyDigests: DailyDigestRepository;
  readonly processingRuns: ProcessingRunRepository;
  readonly logger: Logger;
  readonly id?: () => string;
  readonly now?: () => Date;
}

export class DailyDigestService {
  private readonly id: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: DailyDigestServiceDependencies,
  ) {
    this.id = dependencies.id ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async generate(localDateValue?: unknown): Promise<DailyDigest> {
    const runId = this.id();
    const generatedAt = this.now();
    const startedAt = generatedAt.toISOString();
    await this.dependencies.processingRuns.save(
      this.processingRun({
        id: runId,
        status: "running",
        processedCount: 0,
        failedCount: 0,
        startedAt,
      }),
    );
    this.log("info", "processing_run_started", runId);

    try {
      const localDate = asiaTokyoLocalDate(
        localDateValue,
        generatedAt,
      );
      const range = asiaTokyoDayRange(localDate);
      const digest = await this.dependencies.dailyDigests.generate({
        ...range,
        topInsightLimit: 5,
        lowConfidenceThreshold: 0.5,
        generatedAt: startedAt,
      });
      await this.dependencies.processingRuns.save(
        this.processingRun({
          id: runId,
          status: "succeeded",
          processedCount: 1,
          failedCount: 0,
          startedAt,
          finishedAt: this.now().toISOString(),
        }),
      );
      this.log("info", "processing_run_succeeded", runId);
      return digest;
    } catch (error) {
      const safeError = safeErrorContext(error);
      await this.dependencies.processingRuns.save(
        this.processingRun({
          id: runId,
          status: "failed",
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
  }

  private processingRun(options: {
    readonly id: string;
    readonly status: ProcessingRun["status"];
    readonly processedCount: number;
    readonly failedCount: number;
    readonly startedAt: string;
    readonly finishedAt?: string;
    readonly errorCode?: string;
    readonly errorKind?: string;
  }): ProcessingRun {
    return {
      id: options.id,
      operation: "digest",
      sourceOrProvider: "digest:manual",
      status: options.status,
      receivedCount: 1,
      insertedCount: 0,
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
        operation: "digest",
        runId,
        ...context,
      });
    } catch {
      // Logging must not change the result of a manual digest.
    }
  }
}
