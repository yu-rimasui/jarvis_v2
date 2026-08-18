import type {
  DraftDetailView,
  DraftView,
  ExperimentDetailView,
  ExperimentView,
  InsightDetailView,
  ProcessingRunView,
  RankedInsightView,
  RdSnapshot,
  SourceItemView,
} from "./types.js";

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("API: ")) {
    return error.message.slice(5);
  }
  return "ローカルAPIに接続できません。`npm run api:local`を実行してから再試行してください。";
}

export class LocalApiError extends Error {
  constructor(message: string) {
    super(`API: ${message}`);
    this.name = "LocalApiError";
  }
}

export function localApiErrorMessage(error: unknown): string {
  return messageFromError(error);
}

export async function localApi<T>(
  path: `/api/${string}`,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, options);
  let documentValue: unknown;
  try {
    documentValue = await response.json();
  } catch {
    throw new LocalApiError("ローカルAPIから有効なJSON応答を受け取れませんでした。");
  }
  if (!isRecord(documentValue)) {
    throw new LocalApiError("ローカルAPIの応答形式が不正です。");
  }
  const envelope = documentValue as ApiEnvelope<T>;
  if (!response.ok) {
    const code = envelope.error?.code ?? "REQUEST_FAILED";
    const message = envelope.error?.message ?? "ローカルAPIの処理に失敗しました。";
    throw new LocalApiError(`${code} — ${message}`);
  }
  if (!("data" in envelope)) {
    throw new LocalApiError("ローカルAPIの応答にdataがありません。");
  }
  return envelope.data as T;
}

export function jsonRequest(method: "PATCH" | "POST", value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function listItems<T>(path: `/api/${string}`): Promise<readonly T[]> {
  const result = await localApi<{ readonly items: readonly T[] }>(path);
  return Array.isArray(result.items) ? result.items : [];
}

export async function fetchRdSnapshot(): Promise<RdSnapshot> {
  await localApi<{ readonly status: string }>("/api/health");
  const [inbox, insights, experiments, drafts, history] = await Promise.all([
    listItems<SourceItemView>("/api/inbox?limit=100"),
    listItems<RankedInsightView>("/api/insights?limit=100"),
    listItems<ExperimentView>("/api/experiments"),
    listItems<DraftView>("/api/x-drafts"),
    listItems<ProcessingRunView>("/api/processing-history?limit=100"),
  ]);
  return { inbox, insights, experiments, drafts, history };
}

export function fetchInsight(id: string): Promise<InsightDetailView> {
  return localApi<InsightDetailView>(`/api/insights/${encodeURIComponent(id)}`);
}

export function fetchExperiment(id: string): Promise<ExperimentDetailView> {
  return localApi<ExperimentDetailView>(`/api/experiments/${encodeURIComponent(id)}`);
}

export function fetchDraft(id: string): Promise<DraftDetailView> {
  return localApi<DraftDetailView>(`/api/x-drafts/${encodeURIComponent(id)}`);
}
