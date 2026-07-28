export type LogLevel = "info" | "warn" | "error";

export const LOG_EVENTS = [
  "database_initialized",
  "database_initialization_failed",
  "processing_run_started",
  "processing_run_succeeded",
  "processing_run_failed",
  "pipeline_cli_completed",
  "pipeline_cli_failed",
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];

export interface SafeLogContext {
  readonly operation?: string;
  readonly runId?: string;
  readonly entityId?: string;
  readonly errorCode?: string;
  readonly errorKind?: string;
  readonly count?: number;
  readonly retryCount?: number;
  readonly durationMs?: number;
}

export interface LogRecord extends SafeLogContext {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
}

export interface Logger {
  info(event: LogEvent, context?: SafeLogContext): void;
  warn(event: LogEvent, context?: SafeLogContext): void;
  error(event: LogEvent, context?: SafeLogContext): void;
}

export type LogWriter = (line: string) => void;

const SAFE_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "PIPELINE_EXECUTION_FAILED",
  "COLLECTOR_NOT_CONFIGURED",
  "COLLECTOR_DOWN",
  "DEDUPE_IDENTITY_CONFLICT",
  "ANALYSIS_BUSY",
  "ANALYSIS_CLAIM_LOST",
  "SOURCE_ANALYSIS_NOT_FOUND",
  "EXPERIMENT_NOT_FOUND",
  "EXPERIMENT_INVALID_TRANSITION",
  "EXPERIMENT_CONFLICT",
  "DRAFT_ANALYSIS_NOT_FOUND",
  "DRAFT_SOURCE_NOT_FOUND",
  "DRAFT_EXPERIMENT_NOT_FOUND",
  "DRAFT_EXPERIMENT_MISMATCH",
  "CONTENT_DRAFT_NOT_FOUND",
  "CONTENT_DRAFT_INVALID_TRANSITION",
  "CONTENT_DRAFT_CONFLICT",
  "CONTENT_DRAFT_TOO_LONG",
  "CONTENT_DRAFT_EVIDENCE_VIOLATION",
  "CONTENT_DRAFT_HISTORY_FINALIZATION_FAILED",
  "ERR_SQLITE_ERROR",
]);

function normalizeCode(code: unknown): string {
  return typeof code === "string" && SAFE_ERROR_CODES.has(code)
    ? code
    : "UNSAFE_ERROR_CODE";
}

const SAFE_ERROR_KINDS = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "ValidationError",
  "CollectorNotConfiguredError",
  "DedupeIdentityConflictError",
  "AnalysisBusyError",
  "AnalysisClaimLostError",
  "SourceAnalysisNotFoundError",
  "ExperimentNotFoundError",
  "ExperimentTransitionError",
  "ExperimentConflictError",
  "DraftAnalysisNotFoundError",
  "DraftSourceItemNotFoundError",
  "DraftExperimentNotFoundError",
  "DraftExperimentMismatchError",
  "ContentDraftNotFoundError",
  "ContentDraftTransitionError",
  "ContentDraftConflictError",
  "ContentDraftTooLongError",
  "ContentDraftEvidenceViolationError",
  "ContentDraftHistoryFinalizationError",
  "PipelineExecutionError",
]);

function normalizeKind(kind: unknown): string {
  return typeof kind === "string" && SAFE_ERROR_KINDS.has(kind)
    ? kind
    : "Error";
}

export function safeErrorContext(error: unknown): SafeLogContext {
  try {
    if (error instanceof Error) {
      const code =
        "code" in error && typeof error.code === "string"
          ? normalizeCode(error.code)
          : undefined;

      return {
        ...(code === undefined ? {} : { errorCode: code }),
        errorKind: normalizeKind(error.name),
      };
    }
  } catch {
    return { errorKind: "Error" };
  }

  return { errorKind: "UnknownError" };
}

export function createLogger(
  writer: LogWriter = (line) => {
    process.stdout.write(`${line}\n`);
  },
  now: () => Date = () => new Date(),
): Logger {
  const write = (
    level: LogLevel,
    event: LogEvent,
    context: SafeLogContext = {},
  ): void => {
    const record: LogRecord = {
      timestamp: now().toISOString(),
      level,
      event,
      ...context,
    };

    writer(JSON.stringify(record));
  };

  return {
    info: (event, context) => {
      write("info", event, context);
    },
    warn: (event, context) => {
      write("warn", event, context);
    },
    error: (event, context) => {
      write("error", event, context);
    },
  };
}
