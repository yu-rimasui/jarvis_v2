interface ApiEnvelope {
  readonly data?: {
    readonly items?: readonly unknown[];
  };
}

interface StatusRecord {
  readonly status?: unknown;
}

export interface DashboardSummary {
  readonly openExperiments: number;
  readonly reviewDrafts: number;
}

async function fetchItems(path: string): Promise<readonly StatusRecord[]> {
  const response = await fetch(path);
  const documentValue = (await response.json()) as ApiEnvelope;
  if (!response.ok || !Array.isArray(documentValue.data?.items)) {
    throw new Error(`Unable to load dashboard summary from ${path}`);
  }
  return documentValue.data.items.filter(
    (item): item is StatusRecord => item !== null && typeof item === "object",
  );
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const [experiments, drafts] = await Promise.all([
    fetchItems("/api/experiments"),
    fetchItems("/api/x-drafts"),
  ]);

  return {
    openExperiments: experiments.filter(
      ({ status }) => status !== "completed" && status !== "rejected",
    ).length,
    reviewDrafts: drafts.filter(
      ({ status }) => status === "draft" || status === "needs_review",
    ).length,
  };
}
