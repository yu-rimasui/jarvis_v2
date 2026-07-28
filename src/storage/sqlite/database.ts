import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpenDatabaseOptions {
  readonly createParentDirectory?: boolean;
}

export function openSqliteDatabase(
  databasePath: string,
  options: OpenDatabaseOptions = {},
): DatabaseSync {
  const resolvedPath =
    databasePath === ":memory:" ? databasePath : resolve(databasePath);

  if (
    resolvedPath !== ":memory:" &&
    (options.createParentDirectory ?? false)
  ) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");

  return database;
}
