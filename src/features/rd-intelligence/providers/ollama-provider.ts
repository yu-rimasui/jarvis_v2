import { CATEGORIES, CLAIM_CLASSES } from "../domain/enums.js";
import type { SourceItem } from "../domain/entities.js";
import type { LlmProvider } from "./llm-provider.js";
import type {
  GeneratedXDraft,
  XDraftProvider,
} from "./x-draft-provider.js";

const REQUEST_TIMEOUT_MS = 120_000;
const READINESS_TIMEOUT_MS = 3_000;

export class OllamaConfigurationError extends Error {
  readonly code = "OLLAMA_CONFIGURATION_INVALID";
}

export class OllamaRequestError extends Error {
  readonly code = "OLLAMA_REQUEST_FAILED";
}

export class OllamaOutputError extends Error {
  readonly code = "OLLAMA_OUTPUT_INVALID";
}

interface OllamaProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly fetchImplementation?: typeof fetch;
}

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: unknown;
  };
}

function validatedBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OllamaConfigurationError("OLLAMA_BASE_URL must be a URL");
  }
  const host = parsed.hostname.toLocaleLowerCase("en-US");
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(host) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new OllamaConfigurationError(
      "PH1 Ollama must use an unauthenticated loopback HTTP URL",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed;
}

function analysisSchema(): Readonly<Record<string, unknown>> {
  const score = {
    type: "object",
    additionalProperties: false,
    required: ["score", "reason"],
    properties: {
      score: { type: "number", minimum: 0, maximum: 5 },
      reason: { type: "string" },
    },
  } as const;
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "primaryCategory",
      "secondaryCategories",
      "confidence",
      "confidenceReason",
      "whyItMatters",
      "workUse",
      "suggestedFirstExperiment",
      "trialDifficulty",
      "requiredEnvironment",
      "hypothesis",
      "expectedValue",
      "estimatedEffort",
      "successCriteria",
      "verificationMethod",
      "relatedTechnologies",
      "relatedRepositories",
      "risksAndLimitations",
      "claims",
      "scores",
    ],
    properties: {
      summary: { type: "string" },
      primaryCategory: { type: "string", enum: CATEGORIES },
      secondaryCategories: {
        type: "array",
        items: { type: "string", enum: CATEGORIES },
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      confidenceReason: { type: "string" },
      whyItMatters: { type: "string" },
      workUse: { type: "string" },
      suggestedFirstExperiment: { type: "string" },
      trialDifficulty: {
        type: "string",
        enum: ["beginner", "intermediate", "advanced"],
      },
      requiredEnvironment: { type: "array", items: { type: "string" } },
      hypothesis: { type: "string" },
      expectedValue: { type: "string" },
      estimatedEffort: { type: "string" },
      successCriteria: { type: "string" },
      verificationMethod: { type: "string" },
      relatedTechnologies: { type: "array", items: { type: "string" } },
      relatedRepositories: { type: "array", items: { type: "string" } },
      risksAndLimitations: { type: "array", items: { type: "string" } },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["claimClass", "text"],
          properties: {
            claimClass: { type: "string", enum: CLAIM_CLASSES },
            text: { type: "string" },
            sourceUrl: { type: "string" },
          },
        },
      },
      scores: {
        type: "object",
        additionalProperties: false,
        required: [
          "relevance",
          "novelty",
          "actionability",
          "authorCredibility",
        ],
        properties: {
          relevance: score,
          novelty: score,
          actionability: score,
          authorCredibility: score,
        },
      },
    },
  };
}

function draftSchema(): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  };
}

function parseJsonContent(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OllamaOutputError("Ollama response has no content");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new OllamaOutputError("Ollama response is not valid JSON");
  }
}

export class OllamaProvider implements LlmProvider, XDraftProvider {
  readonly providerId = "ollama-local";
  readonly promptVersion = "analysis-v2";
  readonly schemaVersion = "analysis-v2";
  readonly modelId: string;
  private readonly baseUrl: URL;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = validatedBaseUrl(options.baseUrl);
    this.modelId = options.model.trim();
    if (this.modelId === "" || this.modelId.length > 256) {
      throw new OllamaConfigurationError("OLLAMA_MODEL is invalid");
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async analyze(item: SourceItem): Promise<unknown> {
    const source = {
      title: item.title,
      author: item.author,
      content: item.content,
      sourceUrl: item.canonicalUrl ?? null,
      publishedAt: item.publishedAt ?? null,
    };
    return this.chat(
      [
        {
          role: "system",
          content: [
            "あなたはローカルR&D支援者です。入力だけを根拠に日本語で整理してください。",
            "未確認の主張を事実として断定せず、試せる最小手順へ変換してください。",
            "URLは入力に存在するhttps URLだけを返してください。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(source),
        },
      ],
      analysisSchema(),
    );
  }

  async generateXDraft(
    context: Parameters<XDraftProvider["generateXDraft"]>[0],
  ): Promise<GeneratedXDraft> {
    const sourceUrl = context.sourceItem.canonicalUrl ?? "";
    const content = {
      source: {
        title: context.sourceItem.title,
        summary: context.analysis.summary,
        url: sourceUrl,
      },
      practice: {
        environment: context.practice.environment,
        actions: context.practice.actions,
        result: context.practice.result,
        errors: context.practice.errors,
        learning: context.practice.learning,
        publishableExperience:
          context.practice.publishableExperience,
      },
      instruction: context.shorten
        ? "前回が文字数超過でした。出典URL込みでさらに短くしてください。"
        : "実践結果、詰まり、学びを一人称で簡潔に伝えてください。",
    };
    const response = await this.chat(
      [
        {
          role: "system",
          content: [
            "技術者向けの日本語X投稿を1件だけ作成します。",
            "実際に行ったことだけを一人称で書き、誇張や未確認の成功を追加しません。",
            "出典URLを必ず本文末尾に含めます。",
            "Xの重み付き280文字以内を目標にし、ハッシュタグは使いません。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(content),
          ...(context.practice.images.length === 0
            ? {}
            : {
                images: context.practice.images.map((image) => image.base64),
              }),
        },
      ],
      draftSchema(),
    );
    if (
      typeof response !== "object" ||
      response === null ||
      Array.isArray(response) ||
      typeof (response as Record<string, unknown>)["text"] !== "string"
    ) {
      throw new OllamaOutputError("Ollama draft response is invalid");
    }
    return {
      text: ((response as Record<string, unknown>)["text"] as string).trim(),
    };
  }

  async readiness(): Promise<{
    readonly reachable: boolean;
    readonly modelAvailable: boolean;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
    try {
      const response = await this.fetchImplementation(
        new URL("api/tags", `${this.baseUrl.toString()}/`),
        { signal: controller.signal },
      );
      if (!response.ok) return { reachable: false, modelAvailable: false };
      const value = (await response.json()) as unknown;
      const models =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)["models"]
          : undefined;
      const available =
        Array.isArray(models) &&
        models.some(
          (model) =>
            typeof model === "object" &&
            model !== null &&
            !Array.isArray(model) &&
            [
              (model as Record<string, unknown>)["name"],
              (model as Record<string, unknown>)["model"],
            ].includes(this.modelId),
        );
      return { reachable: true, modelAvailable: available };
    } catch {
      return { reachable: false, modelAvailable: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async chat(
    messages: readonly Readonly<Record<string, unknown>>[],
    format: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetchImplementation(
          new URL("api/chat", `${this.baseUrl.toString()}/`),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: this.modelId,
              stream: false,
              format,
              options: { temperature: 0.2 },
              messages,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new OllamaRequestError("Ollama HTTP error");
        const documentValue = (await response.json()) as OllamaChatResponse;
        return parseJsonContent(documentValue.message?.content);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof OllamaOutputError) throw lastError;
    throw new OllamaRequestError("Ollama request failed after one retry");
  }
}
