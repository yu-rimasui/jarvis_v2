import { homedir } from "node:os";
import { resolve } from "node:path";

export interface RdIntelligenceConfiguration {
  readonly vaultPath: string;
  readonly areaPath: string;
  readonly ollamaBaseUrl: string;
  readonly ollamaModel: string;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  return resolve(value);
}

function requiredValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = environment[name]?.trim() ?? fallback;
  if (value === "" || value.includes("\0")) {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

export function loadRdIntelligenceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): RdIntelligenceConfiguration {
  return {
    vaultPath: expandHome(
      requiredValue(
        environment,
        "RD_OBSIDIAN_VAULT_PATH",
        "~/dev/Knowledge",
      ),
    ),
    areaPath: requiredValue(
      environment,
      "RD_OBSIDIAN_AREA_PATH",
      "03 - AREAS/RD Intelligence",
    ),
    ollamaBaseUrl: requiredValue(
      environment,
      "OLLAMA_BASE_URL",
      "http://127.0.0.1:11434",
    ),
    ollamaModel: requiredValue(
      environment,
      "OLLAMA_MODEL",
      "qwen3-vl:8b",
    ),
  };
}
