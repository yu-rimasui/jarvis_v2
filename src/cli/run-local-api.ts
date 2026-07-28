import { resolve } from "node:path";
import { createLocalApiRuntime } from "../api/local-api-runtime.js";
import {
  LOCAL_API_HOST,
  startLocalApiServer,
} from "../api/local-api-server.js";
import { createLogger, safeErrorContext } from "../logging/logger.js";

interface CliOptions {
  readonly databasePath: string;
  readonly migrationsDirectory: string;
  readonly port: number;
}

function valueAfter(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const candidate = value ?? "4317";
  if (!/^[1-9]\d{0,4}$/u.test(candidate)) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  const port = Number(candidate);
  if (port > 65_535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  return port;
}

function parseOptions(args: readonly string[]): CliOptions {
  const allowed = new Set(["--database", "--migrations", "--port"]);
  for (const option of args.filter((value) => value.startsWith("--"))) {
    if (!allowed.has(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  return {
    databasePath: resolve(
      valueAfter(args, "--database") ?? "data/rd-intelligence.sqlite",
    ),
    migrationsDirectory: resolve(
      valueAfter(args, "--migrations") ?? "migrations",
    ),
    port: parsePort(valueAfter(args, "--port")),
  };
}

const logger = createLogger();
let runtime: ReturnType<typeof createLocalApiRuntime> | undefined;

try {
  const options = parseOptions(process.argv.slice(2));
  runtime = createLocalApiRuntime({
    databasePath: options.databasePath,
    migrationsDirectory: options.migrationsDirectory,
    logger,
  });
  const running = await startLocalApiServer(runtime.application, {
    port: options.port,
  });
  process.stdout.write(
    `${JSON.stringify({
      event: "local_api_started",
      host: LOCAL_API_HOST,
      port: running.port,
    })}\n`,
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      let shutdownError: unknown;
      try {
        await running.close();
      } catch (error) {
        shutdownError = error;
      }
      try {
        runtime?.close();
      } catch (error) {
        shutdownError ??= error;
      }
      if (shutdownError !== undefined) {
        process.stderr.write(
          `${JSON.stringify({
            event: "local_api_shutdown_failed",
            ...safeErrorContext(shutdownError),
          })}\n`,
        );
        process.exitCode = 1;
      }
    })();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  runtime?.close();
  process.stderr.write(
    `${JSON.stringify({
      event: "local_api_failed",
      ...safeErrorContext(error),
    })}\n`,
  );
  process.exitCode = 1;
}
