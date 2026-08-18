import type { DatabaseSync } from "node:sqlite";
import type { CollectorStateRepository } from "../repositories.js";

export class SqliteCollectorStateRepository
  implements CollectorStateRepository
{
  constructor(private readonly database: DatabaseSync) {}

  async findLastSuccessfulAt(
    sourceName: string,
  ): Promise<string | undefined> {
    const row = this.database
      .prepare(
        "SELECT last_successful_at FROM collector_states WHERE source_name = ?",
      )
      .get(sourceName);
    if (row === undefined) return undefined;
    const value = row["last_successful_at"];
    if (typeof value !== "string") {
      throw new TypeError("Invalid collector state timestamp");
    }
    return value;
  }

  async saveLastSuccessfulAt(
    sourceName: string,
    lastSuccessfulAt: string,
    updatedAt: string,
  ): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO collector_states (
          source_name, last_successful_at, updated_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(source_name) DO UPDATE SET
          last_successful_at = excluded.last_successful_at,
          updated_at = excluded.updated_at
      `)
      .run(sourceName, lastSuccessfulAt, updatedAt);
  }
}
