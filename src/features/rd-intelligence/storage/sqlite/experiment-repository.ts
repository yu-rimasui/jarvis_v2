import type { DatabaseSync } from "node:sqlite";
import type {
  EntityId,
  Experiment,
  ExperimentEvent,
  ExperimentRun,
  Learning,
} from "../../domain/entities.js";
import {
  EXPERIMENT_STATUSES,
  HYPOTHESIS_SUPPORT_VALUES,
  type ExperimentStatus,
  type HypothesisSupport,
} from "../../domain/enums.js";
import type { ExperimentRepository } from "../repositories.js";

type SqlRow = Readonly<Record<string, unknown>>;

function stringValue(row: SqlRow, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new TypeError(`Expected string column: ${name}`);
  }
  return value;
}

function numberValue(row: SqlRow, name: string): number {
  const value = row[name];
  if (typeof value !== "number") {
    throw new TypeError(`Expected number column: ${name}`);
  }
  return value;
}

function optionalStringValue(
  row: SqlRow,
  name: string,
): string | undefined {
  const value = row[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Expected nullable string column: ${name}`);
  }
  return value;
}

function stringArrayValue(row: SqlRow, name: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(stringValue(row, name)) as unknown;
  } catch {
    throw new TypeError(`Invalid JSON column: ${name}`);
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new TypeError(`Expected string array column: ${name}`);
  }
  return value;
}

function experimentStatusValue(
  row: SqlRow,
  name: string,
): ExperimentStatus {
  const value = stringValue(row, name);
  if (!EXPERIMENT_STATUSES.includes(value as ExperimentStatus)) {
    throw new TypeError(`Invalid experiment status column: ${name}`);
  }
  return value as ExperimentStatus;
}

function hypothesisSupportValue(
  row: SqlRow,
  name: string,
): HypothesisSupport {
  const value = stringValue(row, name);
  if (
    !HYPOTHESIS_SUPPORT_VALUES.includes(value as HypothesisSupport)
  ) {
    throw new TypeError(`Invalid hypothesis support column: ${name}`);
  }
  return value as HypothesisSupport;
}

function transaction<Result>(
  database: DatabaseSync,
  action: () => Result,
): Result {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = action();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function experimentFromRow(row: SqlRow): Experiment {
  const result = optionalStringValue(row, "result");
  const learned = optionalStringValue(row, "learned");
  const nextDecision = optionalStringValue(row, "next_decision");

  return {
    id: stringValue(row, "id"),
    sourceAnalysisId: stringValue(row, "source_analysis_id"),
    title: stringValue(row, "title"),
    hypothesis: stringValue(row, "hypothesis"),
    expectedValue: stringValue(row, "expected_value"),
    smallestFirstStep: stringValue(row, "smallest_first_step"),
    requiredTools: stringArrayValue(row, "required_tools_json"),
    estimatedEffort: stringValue(row, "estimated_effort"),
    risk: stringValue(row, "risk"),
    successCriteria: stringValue(row, "success_criteria"),
    verificationMethod: stringValue(row, "verification_method"),
    status: experimentStatusValue(row, "status"),
    ...(result === undefined ? {} : { result }),
    ...(learned === undefined ? {} : { learned }),
    ...(nextDecision === undefined ? {} : { nextDecision }),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function eventFromRow(row: SqlRow): ExperimentEvent {
  const fromStatusRaw = optionalStringValue(row, "from_status");
  const reason = optionalStringValue(row, "reason");
  let fromStatus: ExperimentStatus | undefined;
  if (fromStatusRaw !== undefined) {
    if (
      !EXPERIMENT_STATUSES.includes(
        fromStatusRaw as ExperimentStatus,
      )
    ) {
      throw new TypeError("Invalid experiment event from_status");
    }
    fromStatus = fromStatusRaw as ExperimentStatus;
  }

  return {
    id: stringValue(row, "id"),
    experimentId: stringValue(row, "experiment_id"),
    ...(fromStatus === undefined ? {} : { fromStatus }),
    toStatus: experimentStatusValue(row, "to_status"),
    ...(reason === undefined ? {} : { reason }),
    createdAt: stringValue(row, "created_at"),
  };
}

function runFromRow(row: SqlRow): ExperimentRun {
  const completedAt = optionalStringValue(row, "completed_at");
  return {
    id: stringValue(row, "id"),
    experimentId: stringValue(row, "experiment_id"),
    sequence: numberValue(row, "run_sequence"),
    result: stringValue(row, "result"),
    verificationEvidence: stringValue(row, "verification_evidence"),
    startedAt: stringValue(row, "started_at"),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function learningFromRow(row: SqlRow): Learning {
  const nextExperiment = optionalStringValue(row, "next_experiment");
  const publishableFirstHandExperience = optionalStringValue(
    row,
    "publishable_first_hand_experience",
  );
  return {
    id: stringValue(row, "id"),
    experimentId: stringValue(row, "experiment_id"),
    hypothesisSupport: hypothesisSupportValue(
      row,
      "hypothesis_support",
    ),
    reusableKnowledge: stringValue(row, "reusable_knowledge"),
    ...(nextExperiment === undefined ? {} : { nextExperiment }),
    ...(publishableFirstHandExperience === undefined
      ? {}
      : { publishableFirstHandExperience }),
    createdAt: stringValue(row, "created_at"),
  };
}

function assertEvent(
  experiment: Experiment,
  event: ExperimentEvent,
): void {
  if (
    event.experimentId !== experiment.id ||
    event.toStatus !== experiment.status ||
    event.createdAt !== experiment.updatedAt
  ) {
    throw new TypeError("Experiment event does not match experiment");
  }
}

function insertEvent(
  database: DatabaseSync,
  event: ExperimentEvent,
): void {
  database
    .prepare(`
      INSERT INTO experiment_events (
        id, experiment_id, from_status, to_status, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      event.id,
      event.experimentId,
      event.fromStatus ?? null,
      event.toStatus,
      event.reason ?? null,
      event.createdAt,
    );
}

function updateExperiment(
  database: DatabaseSync,
  experiment: Experiment,
  expectedUpdatedAt: string,
  expectedStatus: ExperimentStatus,
): boolean {
  const result = database
    .prepare(`
      UPDATE experiments
      SET status = ?,
          result = ?,
          learned = ?,
          next_decision = ?,
          updated_at = ?
      WHERE id = ? AND status = ? AND updated_at = ?
    `)
    .run(
      experiment.status,
      experiment.result ?? null,
      experiment.learned ?? null,
      experiment.nextDecision ?? null,
      experiment.updatedAt,
      experiment.id,
      expectedStatus,
      expectedUpdatedAt,
    );
  return result.changes === 1;
}

export class SqliteExperimentRepository
  implements ExperimentRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async create(
    experiment: Experiment,
    event: ExperimentEvent,
  ): Promise<void> {
    if (
      experiment.status !== "proposed" ||
      event.fromStatus !== undefined
    ) {
      throw new TypeError("New experiments must start as proposed");
    }
    assertEvent(experiment, event);

    transaction(this.database, () => {
      this.database
        .prepare(`
          INSERT INTO experiments (
            id, source_analysis_id, title, hypothesis, expected_value,
            smallest_first_step, required_tools_json, estimated_effort,
            risk, success_criteria, verification_method, status, result,
            learned, next_decision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          experiment.id,
          experiment.sourceAnalysisId,
          experiment.title,
          experiment.hypothesis,
          experiment.expectedValue,
          experiment.smallestFirstStep,
          JSON.stringify(experiment.requiredTools),
          experiment.estimatedEffort,
          experiment.risk,
          experiment.successCriteria,
          experiment.verificationMethod,
          experiment.status,
          experiment.result ?? null,
          experiment.learned ?? null,
          experiment.nextDecision ?? null,
          experiment.createdAt,
          experiment.updatedAt,
        );
      insertEvent(this.database, event);
    });
  }

  async update(
    experiment: Experiment,
    expectedUpdatedAt: string,
    event: ExperimentEvent,
  ): Promise<boolean> {
    if (event.fromStatus === undefined) {
      throw new TypeError("Experiment transition requires a source status");
    }
    assertEvent(experiment, event);

    return transaction(this.database, () => {
      const updated = updateExperiment(
        this.database,
        experiment,
        expectedUpdatedAt,
        event.fromStatus as ExperimentStatus,
      );
      if (!updated) return false;
      insertEvent(this.database, event);
      return true;
    });
  }

  async complete(
    experiment: Experiment,
    expectedUpdatedAt: string,
    run: ExperimentRun,
    learning: Learning,
    event: ExperimentEvent,
  ): Promise<boolean> {
    const completedAt = run.completedAt;
    if (
      experiment.status !== "completed" ||
      event.fromStatus !== "in_progress" ||
      run.experimentId !== experiment.id ||
      learning.experimentId !== experiment.id ||
      completedAt === undefined
    ) {
      throw new TypeError("Invalid completed experiment transaction");
    }
    assertEvent(experiment, event);

    return transaction(this.database, () => {
      const updated = updateExperiment(
        this.database,
        experiment,
        expectedUpdatedAt,
        "in_progress",
      );
      if (!updated) return false;

      this.database
        .prepare(`
          INSERT INTO experiment_runs (
            id, experiment_id, run_sequence, result,
            verification_evidence, started_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          run.id,
          run.experimentId,
          run.sequence,
          run.result,
          run.verificationEvidence,
          run.startedAt,
          completedAt,
        );
      this.database
        .prepare(`
          INSERT INTO learnings (
            id, experiment_id, hypothesis_support, reusable_knowledge,
            next_experiment, publishable_first_hand_experience, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          learning.id,
          learning.experimentId,
          learning.hypothesisSupport,
          learning.reusableKnowledge,
          learning.nextExperiment ?? null,
          learning.publishableFirstHandExperience ?? null,
          learning.createdAt,
        );
      insertEvent(this.database, event);
      return true;
    });
  }

  async findById(id: EntityId): Promise<Experiment | undefined> {
    const row = this.database
      .prepare("SELECT * FROM experiments WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : experimentFromRow(row);
  }

  async findActiveByAnalysisId(
    analysisId: EntityId,
  ): Promise<Experiment | undefined> {
    const row = this.database
      .prepare(`
        SELECT * FROM experiments
        WHERE source_analysis_id = ?
          AND status IN ('proposed', 'approved', 'in_progress')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `)
      .get(analysisId);
    return row === undefined ? undefined : experimentFromRow(row);
  }

  async list(): Promise<readonly Experiment[]> {
    return this.database
      .prepare(
        "SELECT * FROM experiments ORDER BY updated_at DESC, id DESC",
      )
      .all()
      .map(experimentFromRow);
  }

  async listRuns(
    experimentId: EntityId,
  ): Promise<readonly ExperimentRun[]> {
    return this.database
      .prepare(`
        SELECT *
        FROM experiment_runs
        WHERE experiment_id = ?
        ORDER BY run_sequence, id
      `)
      .all(experimentId)
      .map(runFromRow);
  }

  async listEvents(
    experimentId: EntityId,
  ): Promise<readonly ExperimentEvent[]> {
    return this.database
      .prepare(`
        SELECT *
        FROM experiment_events
        WHERE experiment_id = ?
        ORDER BY created_at, id
      `)
      .all(experimentId)
      .map(eventFromRow);
  }

  async findLearning(
    experimentId: EntityId,
  ): Promise<Learning | undefined> {
    const row = this.database
      .prepare("SELECT * FROM learnings WHERE experiment_id = ?")
      .get(experimentId);
    return row === undefined ? undefined : learningFromRow(row);
  }
}
