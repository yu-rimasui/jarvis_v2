import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CATEGORIES,
  CLAIM_CLASSES,
  DRAFT_STATUSES,
  EXPERIMENT_STATUSES,
} from "../src/features/rd-intelligence/domain/enums.js";
import {
  hashContent,
  normalizeUrl,
} from "../src/features/rd-intelligence/application/normalization.js";
import {
  createLogger,
  safeErrorContext,
} from "../src/features/rd-intelligence/logging/logger.js";
import { initializeDatabase } from "../src/features/rd-intelligence/storage/sqlite/initialize.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-rd-foundation-"));
  temporaryDirectories.push(directory);
  return directory;
}

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("domain enums preserve the required product vocabulary", () => {
  assert.deepEqual(CATEGORIES, [
    "AI Development",
    "Codex",
    "Claude Code",
    "AI Agents",
    "MCP",
    "Test Automation",
    "Software Engineering",
    "DevOps",
    "LLM Research",
    "Other",
  ]);
  assert.deepEqual(CLAIM_CLASSES, [
    "FACT",
    "OBSERVATION",
    "INFERENCE",
    "HYPOTHESIS",
    "IDEA",
  ]);
  assert.deepEqual(EXPERIMENT_STATUSES, [
    "proposed",
    "approved",
    "in_progress",
    "completed",
    "rejected",
    "blocked",
  ]);
  assert.deepEqual(DRAFT_STATUSES, [
    "draft",
    "needs_review",
    "approved",
    "published",
    "rejected",
  ]);
});

test("database initialization applies the schema once and is idempotent", () => {
  const directory = temporaryDirectory();
  const databasePath = join(directory, "rd-intelligence.sqlite");
  const lines: string[] = [];
  const logger = createLogger(
    (line) => {
      lines.push(line);
    },
    () => new Date("2026-07-28T00:00:00.000Z"),
  );

  const first = initializeDatabase({
    databasePath,
    migrationsDirectory: resolve("migrations"),
    logger,
    now: () => new Date("2026-07-28T00:00:00.000Z"),
  });

  assert.deepEqual(
    first.migrations.applied.map((migration) => migration.id),
    [
      "001_init",
      "002_analysis_claims",
      "003_experiment_events",
      "004_content_draft_evidence",
    ],
  );
  assert.deepEqual(first.migrations.alreadyApplied, []);

  const tableRows = first.database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all();
  const tableNames = tableRows.map((row) => {
    const name = row["name"];
    assert.equal(typeof name, "string");
    return name;
  });

  for (const requiredTable of [
    "source_items",
    "topic_clusters",
    "analyses",
    "rankings",
    "experiments",
    "experiment_runs",
    "experiment_events",
    "learnings",
    "content_drafts",
    "content_draft_events",
    "processing_runs",
    "analysis_claims",
    "schema_migrations",
  ]) {
    assert.ok(tableNames.includes(requiredTable), requiredTable);
  }

  const foreignKeys = first.database.prepare("PRAGMA foreign_keys").get();
  assert.equal(foreignKeys?.["foreign_keys"], 1);
  first.database.close();

  const second = initializeDatabase({
    databasePath,
    migrationsDirectory: resolve("migrations"),
    logger,
    now: () => new Date("2026-07-28T00:00:01.000Z"),
  });

  assert.deepEqual(second.migrations.applied, []);
  assert.deepEqual(second.migrations.alreadyApplied, [
    "001_init",
    "002_analysis_claims",
    "003_experiment_events",
    "004_content_draft_evidence",
  ]);
  second.database.close();
  assert.equal(lines.length, 2);
});

test("changed migration contents are rejected after application", () => {
  const directory = temporaryDirectory();
  const migrationsDirectory = join(directory, "migrations");
  const databasePath = join(directory, "checksum.sqlite");
  mkdirSync(migrationsDirectory);
  const copiedMigration = join(migrationsDirectory, "001_init.sql");
  copyFileSync(resolve("migrations/001_init.sql"), copiedMigration);

  const logger = createLogger(() => undefined);
  const initialized = initializeDatabase({
    databasePath,
    migrationsDirectory,
    logger,
  });
  initialized.database.close();

  appendFileSync(copiedMigration, "\n-- unexpected change\n", "utf8");

  assert.throws(
    () => {
      initializeDatabase({
        databasePath,
        migrationsDirectory,
        logger,
      });
    },
    /Migration checksum mismatch: 001_init/u,
  );
});

test("claims, experiment events, and draft evidence are forward-only migrations", () => {
  const directory = temporaryDirectory();
  const migrationsDirectory = join(directory, "migrations");
  const databasePath = join(directory, "upgrade.sqlite");
  mkdirSync(migrationsDirectory);
  copyFileSync(
    resolve("migrations/001_init.sql"),
    join(migrationsDirectory, "001_init.sql"),
  );

  const logger = createLogger(() => undefined);
  const initial = initializeDatabase({
    databasePath,
    migrationsDirectory,
    logger,
  });
  assert.deepEqual(
    initial.migrations.applied.map((migration) => migration.id),
    ["001_init"],
  );
  initial.database.close();

  copyFileSync(
    resolve("migrations/002_analysis_claims.sql"),
    join(migrationsDirectory, "002_analysis_claims.sql"),
  );
  copyFileSync(
    resolve("migrations/003_experiment_events.sql"),
    join(migrationsDirectory, "003_experiment_events.sql"),
  );
  copyFileSync(
    resolve("migrations/004_content_draft_evidence.sql"),
    join(migrationsDirectory, "004_content_draft_evidence.sql"),
  );
  const upgraded = initializeDatabase({
    databasePath,
    migrationsDirectory,
    logger,
  });
  assert.deepEqual(
    upgraded.migrations.applied.map((migration) => migration.id),
    [
      "002_analysis_claims",
      "003_experiment_events",
      "004_content_draft_evidence",
    ],
  );
  assert.deepEqual(upgraded.migrations.alreadyApplied, ["001_init"]);
  const claimTable = upgraded.database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'analysis_claims'",
    )
    .get();
  assert.equal(claimTable?.["name"], "analysis_claims");
  const eventTable = upgraded.database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'experiment_events'",
    )
    .get();
  assert.equal(eventTable?.["name"], "experiment_events");
  const draftEventTable = upgraded.database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'content_draft_events'",
    )
    .get();
  assert.equal(
    draftEventTable?.["name"],
    "content_draft_events",
  );
  upgraded.database.close();
});

test("database initialization refuses an empty migration directory", () => {
  const directory = temporaryDirectory();
  const migrationsDirectory = join(directory, "migrations");
  mkdirSync(migrationsDirectory);

  assert.throws(
    () => {
      initializeDatabase({
        databasePath: join(directory, "empty.sqlite"),
        migrationsDirectory,
        logger: createLogger(() => undefined),
      });
    },
    /No migration files found/u,
  );
});

test("structured errors omit messages and arbitrary personal content", () => {
  const secret = "private source content must not be logged";
  const error = Object.assign(new Error(secret), {
    code: "VALIDATION_ERROR",
  });
  const lines: string[] = [];
  const logger = createLogger(
    (line) => {
      lines.push(line);
    },
    () => new Date("2026-07-28T00:00:00.000Z"),
  );

  logger.error("processing_run_failed", {
    operation: "collect",
    ...safeErrorContext(error),
  });

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /private source content/u);
  assert.match(lines[0] ?? "", /VALIDATION_ERROR/u);
  assert.match(lines[0] ?? "", /processing_run_failed/u);
});

test("structured error extraction is no-throw for hostile properties", () => {
  const adversarial = new Error("private source content");
  Object.defineProperty(adversarial, "name", {
    get() {
      throw new Error("private getter detail");
    },
  });

  assert.deepEqual(safeErrorContext(adversarial), {
    errorKind: "Error",
  });

  const unsafeName = new Error("private source content");
  unsafeName.name = "secret value that must not be retained";
  assert.deepEqual(safeErrorContext(unsafeName), {
    errorKind: "Error",
  });
});

test("normalization keeps meaningful ref parameters and content case", () => {
  assert.equal(
    normalizeUrl(
      "https://EXAMPLE.test/path/?ref=release&utm_source=digest&b=2&a=1",
    ),
    "https://example.test/path?a=1&b=2&ref=release",
  );
  assert.notEqual(hashContent("const Foo = 1;"), hashContent("const foo = 1;"));
});
