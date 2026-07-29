import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface AppliedMigration {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly applied: readonly AppliedMigration[];
  readonly alreadyApplied: readonly string[];
}

interface MigrationFile {
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function loadMigrations(migrationsDirectory: string): readonly MigrationFile[] {
  const directory = resolve(migrationsDirectory);

  return readdirSync(directory)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const path = join(directory, name);
      const sql = readFileSync(path, "utf8");

      return {
        id: basename(name, ".sql"),
        sql,
        checksum: checksum(sql),
      };
    });
}

function ensureMigrationTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function appliedMigrations(database: DatabaseSync): Map<string, string> {
  const rows = database
    .prepare("SELECT id, checksum FROM schema_migrations ORDER BY id")
    .all();

  return new Map(
    rows.map((row) => {
      const id = row["id"];
      const storedChecksum = row["checksum"];

      if (typeof id !== "string" || typeof storedChecksum !== "string") {
        throw new TypeError("Invalid schema_migrations row");
      }

      return [id, storedChecksum] as const;
    }),
  );
}

export function runMigrations(
  database: DatabaseSync,
  migrationsDirectory: string,
  now: () => Date = () => new Date(),
): MigrationResult {
  ensureMigrationTable(database);

  const known = appliedMigrations(database);
  const files = loadMigrations(migrationsDirectory);
  const applied: AppliedMigration[] = [];
  const alreadyApplied: string[] = [];

  if (files.length === 0) {
    throw new Error("No migration files found");
  }

  for (const migration of files) {
    const existingChecksum = known.get(migration.id);

    if (existingChecksum !== undefined) {
      if (existingChecksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.id}`);
      }

      alreadyApplied.push(migration.id);
      continue;
    }

    const appliedAt = now().toISOString();
    database.exec("BEGIN IMMEDIATE;");

    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.id, migration.checksum, appliedAt);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }

    applied.push({
      id: migration.id,
      checksum: migration.checksum,
      appliedAt,
    });
  }

  return { applied, alreadyApplied };
}
