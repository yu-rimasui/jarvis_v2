import { resolve } from "node:path";
import {
  createLogger,
  safeErrorContext,
} from "../logging/logger.js";
import { initializeDatabase } from "../storage/sqlite/initialize.js";

interface CliOptions {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
}

function valueAfter(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parseOptions(args: readonly string[]): CliOptions {
  const allowed = new Set(["--database", "--migrations"]);
  const optionNames = args.filter((value) => value.startsWith("--"));

  for (const optionName of optionNames) {
    if (!allowed.has(optionName)) {
      throw new Error(`Unknown option: ${optionName}`);
    }
  }

  return {
    databasePath: resolve(
      valueAfter(args, "--database") ?? "data/rd-intelligence.sqlite",
    ),
    migrationsDirectory: resolve(
      valueAfter(args, "--migrations") ?? "migrations",
    ),
  };
}

const logger = createLogger();

try {
  const options = parseOptions(process.argv.slice(2));
  const initialized = initializeDatabase({
    databasePath: options.databasePath,
    migrationsDirectory: options.migrationsDirectory,
    logger,
  });

  initialized.database.close();
} catch (error) {
  logger.error("database_initialization_failed", {
    operation: "migrate",
    ...safeErrorContext(error),
  });
  process.exitCode = 1;
}
