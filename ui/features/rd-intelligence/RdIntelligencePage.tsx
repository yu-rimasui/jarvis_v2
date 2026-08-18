import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isStaticPreview } from "../../shared/runtime.js";
import {
  fetchDraft,
  fetchExperiment,
  fetchInsight,
  fetchRdSnapshot,
  jsonRequest,
  localApi,
  localApiErrorMessage,
} from "./api.js";
import type {
  DraftDetailView,
  DraftView,
  ExperimentDetailView,
  ExperimentView,
  InsightDetailView,
  ProcessingRunView,
  RankedInsightView,
  RdSnapshot,
  RdView,
  SourceItemView,
} from "./types.js";
import "./styles.css";

const emptySnapshot: RdSnapshot = {
  inbox: [],
  insights: [],
  experiments: [],
  drafts: [],
  history: [],
};

const views: readonly { readonly id: RdView; readonly label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "insights", label: "Ranked insights" },
  { id: "experiments", label: "Experiments" },
  { id: "drafts", label: "X drafts" },
  { id: "history", label: "History" },
];

type StatusTone = "error" | "neutral" | "success";

interface StatusMessage {
  readonly message: string;
  readonly tone: StatusTone;
}

function value(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

function formatDate(raw: string | undefined): string {
  if (raw === undefined) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function DetailField({ label, value: fieldValue }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rd-detail-field">
      <span>{label}</span>
      <p>{fieldValue || "—"}</p>
    </div>
  );
}

function EmptyState({ children }: { readonly children: string }) {
  return <p className="rd-empty-state">{children}</p>;
}

interface QueueButtonProps {
  readonly badge: string;
  readonly meta: string;
  readonly onClick?: () => void;
  readonly selected?: boolean;
  readonly title: string;
}

function QueueButton({ badge, meta, onClick, selected = false, title }: QueueButtonProps) {
  return (
    <button
      className="rd-queue-button"
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      <strong>{title || "—"}</strong>
      <span>
        <small>{meta || "—"}</small>
        <em>{badge || "—"}</em>
      </span>
    </button>
  );
}

export function RdIntelligencePage() {
  const [snapshot, setSnapshot] = useState<RdSnapshot>(emptySnapshot);
  const [view, setView] = useState<RdView>("inbox");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage>({
    message: "ローカルAPIへ接続しています…",
    tone: "neutral",
  });
  const [insightDetail, setInsightDetail] = useState<InsightDetailView>();
  const [experimentDetail, setExperimentDetail] = useState<ExperimentDetailView>();
  const [draftDetail, setDraftDetail] = useState<DraftDetailView>();
  const busyRef = useRef(false);
  const initialLoadStarted = useRef(false);
  const selectionRef = useRef({ insight: "", experiment: "", draft: "" });
  const tabRefs = useRef(new Map<RdView, HTMLButtonElement>());

  const refresh = useCallback(async (announce = true): Promise<RdSnapshot | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    if (announce) {
      setStatus({ message: "ローカルAPIと保存済みデータを確認しています…", tone: "neutral" });
    }
    try {
      const next = await fetchRdSnapshot();
      setSnapshot(next);
      setConnected(true);
      if (announce) {
        setStatus({
          message: "保存済みデータを更新しました。収集・生成・投稿は実行していません。",
          tone: "success",
        });
      }
      return next;
    } catch (error) {
      setConnected(false);
      setStatus({ message: localApiErrorMessage(error), tone: "error" });
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void refresh();
  }, [refresh]);

  const loadInsight = useCallback(async (id: string) => {
    if (!id) return;
    selectionRef.current.insight = id;
    setInsightDetail(undefined);
    try {
      const detail = await fetchInsight(id);
      if (selectionRef.current.insight !== id) return;
      if (detail.analysis.id !== id) throw new Error("API: Insight IDが一致しません。");
      setInsightDetail(detail);
      setStatus({ message: "Insightの根拠とスコアを表示しています。", tone: "success" });
    } catch (error) {
      if (selectionRef.current.insight !== id) return;
      setStatus({ message: localApiErrorMessage(error), tone: "error" });
    }
  }, []);

  const loadExperiment = useCallback(async (id: string) => {
    if (!id) return;
    selectionRef.current.experiment = id;
    setExperimentDetail(undefined);
    try {
      const detail = await fetchExperiment(id);
      if (selectionRef.current.experiment !== id) return;
      if (detail.experiment.id !== id) throw new Error("API: Experiment IDが一致しません。");
      setExperimentDetail(detail);
      setStatus({ message: "実験の状態と監査履歴を表示しています。", tone: "success" });
    } catch (error) {
      if (selectionRef.current.experiment !== id) return;
      setStatus({ message: localApiErrorMessage(error), tone: "error" });
    }
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    if (!id) return;
    selectionRef.current.draft = id;
    setDraftDetail(undefined);
    try {
      const detail = await fetchDraft(id);
      if (selectionRef.current.draft !== id) return;
      if (detail.draft.id !== id) throw new Error("API: Draft IDが一致しません。");
      setDraftDetail(detail);
      setStatus({
        message: "下書きの根拠とレビュー履歴を表示しています。投稿は行いません。",
        tone: "success",
      });
    } catch (error) {
      if (selectionRef.current.draft !== id) return;
      setStatus({ message: localApiErrorMessage(error), tone: "error" });
    }
  }, []);

  const mutate = useCallback(
    async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      setStatus({ message: `${label}をローカルに記録しています…`, tone: "neutral" });
      try {
        const result = await work();
        const next = await fetchRdSnapshot();
        setSnapshot(next);
        setConnected(true);
        setStatus({ message: `${label}をローカルに記録しました。`, tone: "success" });
        return result;
      } catch (error) {
        setStatus({ message: localApiErrorMessage(error), tone: "error" });
        return undefined;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  function selectView(nextView: RdView, focus = false) {
    setView(nextView);
    if (focus) queueMicrotask(() => tabRefs.current.get(nextView)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: RdView) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = views.findIndex((item) => item.id === current);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? views.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    const next = views[nextIndex];
    if (next !== undefined) selectView(next.id, true);
  }

  async function importInbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const textarea = form.elements.namedItem("json");
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    let payload: unknown;
    try {
      payload = JSON.parse(textarea.value);
    } catch {
      setStatus({ message: "JSONの構文を確認してください。取込は実行されていません。", tone: "error" });
      textarea.focus();
      return;
    }
    const result = await mutate("Inbox取込と分析", () =>
      localApi("/api/inbox/import", jsonRequest("POST", payload)),
    );
    if (result !== undefined) form.reset();
  }

  async function proposeExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (insightDetail === undefined) return;
    const data = new FormData(event.currentTarget);
    const payload = {
      title: value(data, "title"),
      hypothesis: value(data, "hypothesis"),
      expectedValue: value(data, "expectedValue"),
      smallestFirstStep: value(data, "smallestFirstStep"),
      requiredTools: value(data, "requiredTools").split(",").map((item) => item.trim()).filter(Boolean),
      estimatedEffort: value(data, "estimatedEffort"),
      risk: value(data, "risk"),
      successCriteria: value(data, "successCriteria"),
      verificationMethod: value(data, "verificationMethod"),
    };
    await mutate("実験提案", () =>
      localApi(
        `/api/insights/${encodeURIComponent(insightDetail.analysis.id)}/experiments`,
        jsonRequest("POST", payload),
      ),
    );
  }

  async function generateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (insightDetail === undefined) return;
    const data = new FormData(event.currentTarget);
    const experimentId = value(data, "experimentId");
    const result = await mutate<{ readonly draft: DraftView }>("X下書き生成", () =>
      localApi(
        `/api/insights/${encodeURIComponent(insightDetail.analysis.id)}/x-drafts`,
        jsonRequest("POST", experimentId ? { experimentId } : {}),
      ),
    );
    if (result !== undefined) {
      selectView("drafts");
      await loadDraft(result.draft.id);
    }
  }

  async function experimentAction(action: "approve" | "start") {
    const id = experimentDetail?.experiment.id;
    if (id === undefined) return;
    const result = await mutate(`実験を${action === "approve" ? "承認" : "開始"}`, () =>
      localApi(`/api/experiments/${encodeURIComponent(id)}/${action}`, jsonRequest("POST", {})),
    );
    if (result !== undefined) await loadExperiment(id);
  }

  async function decideExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = experimentDetail?.experiment.id;
    if (id === undefined) return;
    const data = new FormData(event.currentTarget);
    const action = value(data, "action");
    const reason = value(data, "reason");
    if (action !== "block" && action !== "reject") return;
    const result = await mutate(action === "block" ? "実験のブロック" : "実験の却下", () =>
      localApi(`/api/experiments/${encodeURIComponent(id)}/${action}`, jsonRequest("POST", { reason })),
    );
    if (result !== undefined) {
      event.currentTarget.reset();
      await loadExperiment(id);
    }
  }

  async function completeExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = experimentDetail?.experiment.id;
    if (id === undefined) return;
    const data = new FormData(event.currentTarget);
    const nextExperiment = value(data, "nextExperiment");
    const publishableFirstHandExperience = value(data, "publishableFirstHandExperience");
    const payload = {
      result: value(data, "result"),
      verificationEvidence: value(data, "verificationEvidence"),
      learned: value(data, "learned"),
      nextDecision: value(data, "nextDecision"),
      hypothesisSupport: value(data, "hypothesisSupport"),
      reusableKnowledge: value(data, "reusableKnowledge"),
      ...(nextExperiment ? { nextExperiment } : {}),
      ...(publishableFirstHandExperience ? { publishableFirstHandExperience } : {}),
    };
    const result = await mutate("実験結果", () =>
      localApi(`/api/experiments/${encodeURIComponent(id)}/complete`, jsonRequest("POST", payload)),
    );
    if (result !== undefined) await loadExperiment(id);
  }

  async function editDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = draftDetail?.draft.id;
    if (id === undefined) return;
    const data = new FormData(event.currentTarget);
    const payload = {
      hook: value(data, "hook"),
      body: value(data, "body"),
      keyTakeaway: value(data, "keyTakeaway"),
      sourceLinks: value(data, "sourceLinks").split("\n").map((item) => item.trim()).filter(Boolean),
    };
    const result = await mutate("X下書きの変更", () =>
      localApi(`/api/x-drafts/${encodeURIComponent(id)}`, jsonRequest("PATCH", payload)),
    );
    if (result !== undefined) await loadDraft(id);
  }

  async function draftAction(action: "approve" | "review") {
    const id = draftDetail?.draft.id;
    if (id === undefined) return;
    const result = await mutate(
      action === "review" ? "X下書きをレビューへ送付" : "X下書きの人間レビュー承認",
      () => localApi(`/api/x-drafts/${encodeURIComponent(id)}/${action}`, jsonRequest("POST", {})),
    );
    if (result !== undefined) await loadDraft(id);
  }

  async function copyDraft() {
    const draft = draftDetail?.draft;
    if (draft === undefined) return;
    const copyText = [draft.hook, draft.body, draft.keyTakeaway].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(copyText);
      setStatus({ message: "下書きをクリップボードへコピーしました。投稿は行っていません。", tone: "success" });
    } catch {
      setStatus({ message: "コピーできませんでした。入力欄から手動でコピーしてください。", tone: "error" });
    }
  }

  async function generateDigest() {
    await mutate("本日のダイジェスト", () => localApi("/api/digests", jsonRequest("POST", {})));
  }

  return (
    <section className="rd-page" aria-labelledby="rd-page-title">
      <header className="rd-page-heading">
        <div>
          <Link className="back-link" to="/">← Dashboard</Link>
          <p className="page-eyebrow">LOCAL RESEARCH / HUMAN REVIEW</p>
          <h1 id="rd-page-title">R&amp;D Intelligence</h1>
          <p>根拠から小さな実験とレビュー済み下書きを作る、ローカル専用の作業面です。</p>
        </div>
        <button
          className="rd-primary-button"
          type="button"
          disabled={busy || isStaticPreview}
          onClick={() => void refresh()}
        >
          {isStaticPreview ? "プレビュー専用" : busy ? "更新中…" : "ローカルデータを更新"}
        </button>
      </header>

      <div className={`rd-status-message rd-status-${status.tone}`} role="status" aria-live="polite">
        <span aria-hidden="true" />
        {status.message}
      </div>

      {!connected ? (
        <aside className="rd-connection-panel">
          <strong>
            {isStaticPreview ? "GitHub Pages UIプレビュー" : "ローカルAPIは未確認です"}
          </strong>
          <p>
            {isStaticPreview
              ? "公開版は表示確認専用です。データ操作と保存はローカル版で行ってください。"
              : "`npm run api:local`で起動すると、保存済みデータを読み取れます。"}
          </p>
        </aside>
      ) : null}

      <div className="rd-tabs" role="tablist" aria-label="R&D Intelligence表示">
        {views.map((item) => (
          <button
            key={item.id}
            ref={(element) => {
              if (element === null) tabRefs.current.delete(item.id);
              else tabRefs.current.set(item.id, element);
            }}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            aria-controls={`rd-panel-${item.id}`}
            tabIndex={view === item.id ? 0 : -1}
            onClick={() => selectView(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, item.id)}
          >
            {item.label}
            <span>{countForView(snapshot, item.id)}</span>
          </button>
        ))}
      </div>

      {view === "inbox" ? <InboxPanel items={snapshot.inbox} busy={busy} onImport={importInbox} /> : null}
      {view === "insights" ? (
        <InsightsPanel
          insights={snapshot.insights}
          experiments={snapshot.experiments}
          detail={insightDetail}
          selectedId={selectionRef.current.insight}
          busy={busy}
          onSelect={(id) => void loadInsight(id)}
          onPropose={proposeExperiment}
          onGenerateDraft={generateDraft}
        />
      ) : null}
      {view === "experiments" ? (
        <ExperimentsPanel
          experiments={snapshot.experiments}
          detail={experimentDetail}
          selectedId={selectionRef.current.experiment}
          busy={busy}
          onSelect={(id) => void loadExperiment(id)}
          onAction={(action) => void experimentAction(action)}
          onDecision={decideExperiment}
          onComplete={completeExperiment}
        />
      ) : null}
      {view === "drafts" ? (
        <DraftsPanel
          drafts={snapshot.drafts}
          detail={draftDetail}
          selectedId={selectionRef.current.draft}
          busy={busy}
          onSelect={(id) => void loadDraft(id)}
          onEdit={editDraft}
          onAction={(action) => void draftAction(action)}
          onCopy={() => void copyDraft()}
        />
      ) : null}
      {view === "history" ? (
        <HistoryPanel history={snapshot.history} busy={busy} onGenerateDigest={() => void generateDigest()} />
      ) : null}
    </section>
  );
}

function countForView(snapshot: RdSnapshot, view: RdView): number {
  if (view === "inbox") return snapshot.inbox.length;
  if (view === "insights") return snapshot.insights.length;
  if (view === "experiments") return snapshot.experiments.length;
  if (view === "drafts") return snapshot.drafts.length;
  return snapshot.history.length;
}

function Panel({ children, label, id }: { readonly children: React.ReactNode; readonly id: string; readonly label: string }) {
  return (
    <section id={id} className="rd-panel-grid" role="tabpanel" aria-label={label}>
      {children}
    </section>
  );
}

function PanelCard({ children, eyebrow, title }: { readonly children: React.ReactNode; readonly eyebrow: string; readonly title: string }) {
  return (
    <article className="rd-panel-card">
      <header><div><p>{eyebrow}</p><h2>{title}</h2></div></header>
      {children}
    </article>
  );
}

function InboxPanel({ items, busy, onImport }: { readonly items: readonly SourceItemView[]; readonly busy: boolean; readonly onImport: (event: FormEvent<HTMLFormElement>) => void }) {
  const sample = JSON.stringify({
    items: [{
      sourceType: "manual",
      sourceExternalId: "synthetic-ui-sample-001",
      title: "合成サンプル: ローカル実験の候補",
      author: "Synthetic Local Author",
      content: "これは実在データではない合成サンプルです。小さなローカル検証を記録します。",
      sourceMetadata: { synthetic: true, importedFrom: "rd-react-ui-sample" },
    }],
  }, null, 2);
  const [json, setJson] = useState("");
  return (
    <Panel id="rd-panel-inbox" label="Inbox">
      <PanelCard eyebrow={`${items.length} ITEMS`} title="Collected inbox">
        <div className="rd-queue">
          {items.length === 0 ? <EmptyState>保存済み項目はありません。</EmptyState> : items.map((item) => (
            <QueueButton key={item.id} title={item.title} meta={item.author} badge={item.sourceType} />
          ))}
        </div>
      </PanelCard>
      <PanelCard eyebrow="EXPLICIT ONLY" title="Manual JSON import">
        <p className="rd-help">入力は「JSONを取り込む」を押すまで保存されません。取込後はローカル分析を実行します。</p>
        <form className="rd-form" onSubmit={onImport}>
          <label>取込JSON<textarea name="json" rows={12} required spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} placeholder='{"items": […]}' /></label>
          <div className="rd-form-actions">
            <button type="button" onClick={() => setJson(sample)}>合成サンプルを入力</button>
            <button className="rd-primary-button" type="submit" disabled={busy}>JSONを取り込む</button>
          </div>
        </form>
      </PanelCard>
    </Panel>
  );
}

function InsightsPanel({ insights, experiments, detail, selectedId, busy, onSelect, onPropose, onGenerateDraft }: {
  readonly insights: readonly RankedInsightView[];
  readonly experiments: readonly ExperimentView[];
  readonly detail: InsightDetailView | undefined;
  readonly selectedId: string;
  readonly busy: boolean;
  readonly onSelect: (id: string) => void;
  readonly onPropose: (event: FormEvent<HTMLFormElement>) => void;
  readonly onGenerateDraft: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Panel id="rd-panel-insights" label="Ranked insights">
      <PanelCard eyebrow={`${insights.length} ITEMS`} title="Ranked insights">
        <div className="rd-queue">
          {insights.length === 0 ? <EmptyState>Inboxを取り込むと、分析結果が表示されます。</EmptyState> : insights.map(({ analysis, ranking }) => (
            <QueueButton key={analysis.id} title={analysis.summary || analysis.primaryCategory} meta={analysis.primaryCategory} badge={`${ranking.overallScore} pts`} selected={selectedId === analysis.id} onClick={() => onSelect(analysis.id)} />
          ))}
        </div>
      </PanelCard>
      <PanelCard eyebrow={detail === undefined ? "SELECT ONE" : `${detail.ranking.overallScore} PTS`} title="Insight detail">
        {detail === undefined ? <EmptyState>左のInsightを選択すると、要約・スコア・根拠を確認できます。</EmptyState> : (
          <div className="rd-detail-stack">
            <div className="rd-detail-grid">
              <DetailField label="SUMMARY" value={detail.analysis.summary} />
              <DetailField label="WHY IT MATTERS" value={detail.analysis.whyItMatters} />
              <DetailField label="WORK USE" value={detail.analysis.workUse} />
              <DetailField label="CONFIDENCE" value={`${detail.analysis.confidence} — ${detail.analysis.confidenceReason}`} />
            </div>
            <section className="rd-evidence-section"><h3>Evidence claims</h3><ul>{detail.analysis.claims.map((claim, index) => <li key={`${claim.claimClass}-${index}`}>{claim.claimClass}: {claim.text}</li>)}</ul></section>
            <ExperimentProposalForm key={detail.analysis.id} detail={detail} busy={busy} onSubmit={onPropose} />
            <form className="rd-inline-form" onSubmit={onGenerateDraft}>
              <label>関連する完了済み実験<select name="experimentId"><option value="">なし（ソース根拠のみ）</option>{experiments.filter((experiment) => experiment.sourceAnalysisId === detail.analysis.id && experiment.status === "completed").map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.title}</option>)}</select></label>
              <button type="submit" disabled={busy}>X下書きを生成</button>
              <small>コピー用・人間レビュー必須。自動投稿は行いません。</small>
            </form>
          </div>
        )}
      </PanelCard>
    </Panel>
  );
}

function ExperimentProposalForm({ detail, busy, onSubmit }: { readonly detail: InsightDetailView; readonly busy: boolean; readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const analysis = detail.analysis;
  return (
    <form className="rd-form rd-nested-form" onSubmit={onSubmit}>
      <h3>小さな実験を提案</h3>
      <label>実験名<input name="title" required maxLength={1000} defaultValue={`検証: ${analysis.suggestedFirstExperiment || analysis.primaryCategory}`} /></label>
      <label>仮説<textarea name="hypothesis" required defaultValue={analysis.suggestedFirstExperiment || "この検証で次の判断に必要な根拠を得られる。"} /></label>
      <div className="rd-form-two"><label>期待値<input name="expectedValue" required defaultValue={analysis.workUse} /></label><label>見積り<input name="estimatedEffort" required defaultValue="20分" /></label></div>
      <label>最小の最初の一歩<input name="smallestFirstStep" required defaultValue={analysis.suggestedFirstExperiment} /></label>
      <label>必要なツール<input name="requiredTools" required defaultValue="Node.js, SQLite" /></label>
      <label>リスク<textarea name="risk" required defaultValue={analysis.risksAndLimitations[0] ?? "合成データは実運用を完全には再現しない。"} /></label>
      <label>成功基準<textarea name="successCriteria" required defaultValue="小さな検証結果と根拠をローカルに記録できる。" /></label>
      <label>検証方法<textarea name="verificationMethod" required defaultValue="実験状態と結果をローカルAPIから再読込して確認する。" /></label>
      <button className="rd-primary-button" type="submit" disabled={busy}>実験を提案する</button>
    </form>
  );
}

function ExperimentsPanel({ experiments, detail, selectedId, busy, onSelect, onAction, onDecision, onComplete }: {
  readonly experiments: readonly ExperimentView[];
  readonly detail: ExperimentDetailView | undefined;
  readonly selectedId: string;
  readonly busy: boolean;
  readonly onSelect: (id: string) => void;
  readonly onAction: (action: "approve" | "start") => void;
  readonly onDecision: (event: FormEvent<HTMLFormElement>) => void;
  readonly onComplete: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const experiment = detail?.experiment;
  const runs = detail?.runs ?? [];
  const learning = detail?.learning;
  const events = detail?.events ?? [];
  return (
    <Panel id="rd-panel-experiments" label="Experiments">
      <PanelCard eyebrow={`${experiments.length} ITEMS`} title="Experiment queue">
        <div className="rd-queue">{experiments.length === 0 ? <EmptyState>提案済みの実験はありません。</EmptyState> : experiments.map((item) => <QueueButton key={item.id} title={item.title} meta={item.estimatedEffort} badge={item.status} selected={selectedId === item.id} onClick={() => onSelect(item.id)} />)}</div>
      </PanelCard>
      <PanelCard eyebrow={experiment?.status.toUpperCase() ?? "SELECT ONE"} title="Experiment detail">
        {experiment === undefined ? <EmptyState>実験を選択すると、状態・履歴・学びを確認できます。</EmptyState> : (
          <div className="rd-detail-stack">
            <h3 className="rd-detail-title">{experiment.title}</h3>
            <div className="rd-detail-grid"><DetailField label="HYPOTHESIS" value={experiment.hypothesis} /><DetailField label="EXPECTED VALUE" value={experiment.expectedValue} /><DetailField label="FIRST STEP" value={experiment.smallestFirstStep} /><DetailField label="SUCCESS" value={experiment.successCriteria} /><DetailField label="VERIFICATION" value={experiment.verificationMethod} /><DetailField label="RISK" value={experiment.risk} /></div>
            {runs.length > 0 ? <section className="rd-evidence-section"><h3>Recorded result</h3><ul>{runs.map((run, index) => <li key={index}>{run.result} / 根拠: {run.verificationEvidence}</li>)}</ul></section> : null}
            {learning !== undefined ? <section className="rd-evidence-section"><h3>Learning</h3><ul><li>仮説: {learning.hypothesisSupport}</li><li>{learning.reusableKnowledge}</li>{learning.nextExperiment !== undefined ? <li>次: {learning.nextExperiment}</li> : null}</ul></section> : null}
            <EventHistory events={events} title="State history" />
            <div className="rd-form-actions">{["proposed", "blocked"].includes(experiment.status) ? <button type="button" disabled={busy} onClick={() => onAction("approve")}>承認する</button> : null}{experiment.status === "approved" ? <button className="rd-primary-button" type="button" disabled={busy} onClick={() => onAction("start")}>開始する</button> : null}</div>
            {["proposed", "approved", "in_progress"].includes(experiment.status) ? <form className="rd-inline-form" onSubmit={onDecision}><label>理由を記録して状態変更<div className="rd-form-two"><select name="action"><option value="block">ブロックする</option><option value="reject">却下する</option></select><input name="reason" required maxLength={4000} placeholder="理由" /></div></label><button type="submit" disabled={busy}>理由を記録</button></form> : null}
            {experiment.status === "in_progress" ? <CompletionForm busy={busy} onSubmit={onComplete} /> : null}
          </div>
        )}
      </PanelCard>
    </Panel>
  );
}

function CompletionForm({ busy, onSubmit }: { readonly busy: boolean; readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="rd-form rd-nested-form" onSubmit={onSubmit}><h3>結果を記録して完了</h3><label>結果<textarea name="result" required /></label><label>検証根拠<textarea name="verificationEvidence" required /></label><label>学び<textarea name="learned" required /></label><label>次の判断<textarea name="nextDecision" required /></label><label>仮説への結論<select name="hypothesisSupport"><option value="supported">支持された</option><option value="partially_supported">部分的に支持された</option><option value="not_supported">支持されなかった</option><option value="inconclusive">結論保留</option></select></label><label>再利用できる知識<textarea name="reusableKnowledge" required /></label><label>次の実験（任意）<textarea name="nextExperiment" /></label><label>公開可能な一次体験（実施済みの場合だけ・任意）<textarea name="publishableFirstHandExperience" /></label><button className="rd-primary-button" type="submit" disabled={busy}>結果を記録する</button></form>;
}

function DraftsPanel({ drafts, detail, selectedId, busy, onSelect, onEdit, onAction, onCopy }: {
  readonly drafts: readonly DraftView[];
  readonly detail: DraftDetailView | undefined;
  readonly selectedId: string;
  readonly busy: boolean;
  readonly onSelect: (id: string) => void;
  readonly onEdit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onAction: (action: "approve" | "review") => void;
  readonly onCopy: () => void;
}) {
  const draft = detail?.draft;
  const events = detail?.events ?? [];
  return (
    <Panel id="rd-panel-drafts" label="X drafts">
      <PanelCard eyebrow={`${drafts.length} ITEMS`} title="X draft queue"><div className="rd-queue">{drafts.length === 0 ? <EmptyState>生成済みの下書きはありません。</EmptyState> : drafts.map((item) => <QueueButton key={item.id} title={item.hook} meta={item.evidenceScope} badge={item.status} selected={selectedId === item.id} onClick={() => onSelect(item.id)} />)}</div></PanelCard>
      <PanelCard eyebrow={draft?.status.toUpperCase() ?? "SELECT ONE"} title="X draft / human review">
        <p className="rd-review-note">この画面に投稿・公開操作はありません。コピー後も人間の判断が必要です。</p>
        {draft === undefined ? <EmptyState>下書きを選択すると、根拠とレビュー履歴を確認できます。</EmptyState> : <div className="rd-detail-stack"><div className="rd-detail-grid"><DetailField label="EVIDENCE SCOPE" value={draft.evidenceScope} /><DetailField label="CHARACTERS" value={String(draft.characterCount)} /><DetailField label="RELATED INSIGHT" value={draft.relatedAnalysisId} /><DetailField label="RELATED EXPERIMENT" value={draft.relatedExperimentId ?? "—"} /></div><section className="rd-evidence-section"><h3>Evidence provenance</h3><ul>{draft.provenance.map((evidence, index) => <li key={`${evidence.kind}-${index}`}>{evidence.kind}: {evidence.text}</li>)}</ul></section><EventHistory events={events} title="Review history" /><form key={draft.id} className="rd-form rd-nested-form" onSubmit={onEdit}><label>Hook<textarea name="hook" required defaultValue={draft.hook} /></label><label>Body<textarea name="body" required defaultValue={draft.body} /></label><label>Key takeaway<textarea name="keyTakeaway" required defaultValue={draft.keyTakeaway} /></label><label>Source links<textarea name="sourceLinks" defaultValue={draft.sourceLinks.join("\n")} /></label><div className="rd-form-actions"><button type="submit" disabled={busy || draft.status === "published"}>変更を保存</button><button type="button" onClick={onCopy}>コピー</button>{draft.status === "draft" ? <button className="rd-primary-button" type="button" disabled={busy} onClick={() => onAction("review")}>レビューへ送る</button> : null}{draft.status === "needs_review" ? <button className="rd-primary-button" type="button" disabled={busy} onClick={() => onAction("approve")}>人間レビューを承認</button> : null}</div></form></div>}
      </PanelCard>
    </Panel>
  );
}

function EventHistory({ events, title }: { readonly events: readonly { readonly createdAt: string; readonly reason?: string; readonly toStatus: string }[]; readonly title: string }) {
  if (events.length === 0) return null;
  return <section className="rd-evidence-section"><h3>{title}</h3><ul>{events.map((event, index) => <li key={`${event.createdAt}-${index}`}>{formatDate(event.createdAt)} → {event.toStatus}{event.reason !== undefined ? ` (${event.reason})` : ""}</li>)}</ul></section>;
}

function HistoryPanel({ history, busy, onGenerateDigest }: { readonly history: readonly ProcessingRunView[]; readonly busy: boolean; readonly onGenerateDigest: () => void }) {
  return <section id="rd-panel-history" className="rd-history-panel" role="tabpanel" aria-label="Processing history"><PanelCard eyebrow={`${history.length} RUNS`} title="Processing history"><div className="rd-history-heading"><p className="rd-help">手動操作によるローカル処理履歴です。定期実行はありません。</p><button type="button" disabled={busy} onClick={onGenerateDigest}>本日のダイジェストを生成</button></div><div className="rd-history-list">{history.length === 0 ? <EmptyState>処理履歴はありません。</EmptyState> : history.map((run) => <article key={run.id}><header><strong>{run.operation}</strong><span data-status={run.status}>{run.status}</span></header><p>{run.sourceOrProvider}</p><dl><div><dt>inserted</dt><dd>{run.insertedCount}</dd></div><div><dt>processed</dt><dd>{run.processedCount}</dd></div><div><dt>duplicate</dt><dd>{run.duplicateCount}</dd></div><div><dt>failed</dt><dd>{run.failedCount}</dd></div></dl><small>{formatDate(run.finishedAt ?? run.startedAt)}{run.errorCode !== undefined ? ` / ${run.errorCode}` : ""}</small></article>)}</div></PanelCard></section>;
}
