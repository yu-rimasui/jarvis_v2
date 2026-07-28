import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../logging/logger.js";
import { openSqliteDatabase } from "./database.js";
import { runMigrations, type MigrationResult } from "./migrations.js";

export interface InitializeDatabaseOptions {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface InitializedDatabase {
  readonly database: DatabaseSync;
  readonly migrations: MigrationResult;
}

export function initializeDatabase(
  options: InitializeDatabaseOptions,
): InitializedDatabase {
  const startedAt = performance.now();
  const database = openSqliteDatabase(options.databasePath, {
    createParentDirectory: options.databasePath !== ":memory:",
  });

  try {
    const migrations = runMigrations(
      database,
      options.migrationsDirectory,
      options.now,
    );

    options.logger.info("database_initialized", {
      operation: "migrate",
      count: migrations.applied.length,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return { database, migrations };
  } catch (error) {
    database.close();
    throw error;
  }
}
