(() => {
  'use strict';

  const root = document.querySelector('#rd-intelligence');
  if (root === null) return;

  const dashboardGrid = document.querySelector('.dashboard-grid');
  const commandBar = document.querySelector('.command-bar');
  const openButtons = document.querySelectorAll(
    '#open-rd-intelligence, #open-rd-intelligence-panel',
  );
  const backButton = document.querySelector('#rd-back');
  const refreshButton = document.querySelector('#rd-refresh');
  const connection = document.querySelector('#rd-connection');
  const status = document.querySelector('#rd-status');
  const tabs = Array.from(root.querySelectorAll('[data-rd-view]'));
  const panels = Array.from(root.querySelectorAll('[data-rd-panel]'));
  let launchButton = null;

  const state = {
    connected: false,
    busy: false,
    data: {
      inbox: [],
      insights: [],
      experiments: [],
      drafts: [],
      history: [],
    },
    selected: {
      insightId: null,
      experimentId: null,
      draftId: null,
    },
    details: {
      insight: null,
      experiment: null,
      draft: null,
    },
  };

  function byId(id) {
    const element = document.querySelector(`#${id}`);
    if (element === null) throw new Error(`Missing #${id}`);
    return element;
  }

  function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value, fallback = '—') {
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
  }

  function number(value, fallback = '—') {
    return typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : fallback;
  }

  function formatDate(value) {
    if (typeof value !== 'string') return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function create(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function setStatus(message, tone = 'neutral') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function isCurrentSelection(key, id) {
    return state.selected[key] === id;
  }

  function responseEntityId(detail, key) {
    return text(asRecord(asRecord(detail)[key]).id, '');
  }

  function errorMessage(error) {
    if (error instanceof Error && error.message.startsWith('API:')) {
      return error.message.slice(4);
    }
    return 'ローカルAPIに接続できません。`npm run api:local` を実行してから、もう一度更新してください。';
  }

  async function api(path, options) {
    if (!path.startsWith('/api/')) {
      throw new Error('API: 無効なローカルAPIパスです。');
    }
    const response = await fetch(path, options);
    let documentValue;
    try {
      documentValue = await response.json();
    } catch {
      throw new Error('API: ローカルAPIから有効なJSON応答を受け取れませんでした。');
    }
    const responseRecord = asRecord(documentValue);
    if (!response.ok) {
      const error = asRecord(responseRecord.error);
      const code = text(error.code, 'REQUEST_FAILED');
      const message = text(error.message, 'ローカルAPIの処理に失敗しました。');
      throw new Error(`API: ${code} — ${message}`);
    }
    return responseRecord.data;
  }

  function jsonOptions(method, value) {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    };
  }

  async function refreshData(followingMutation = false) {
    if (state.busy && !followingMutation) return;
    const wasBusy = state.busy;
    state.busy = true;
    refreshButton.disabled = true;
    setStatus('ローカルAPIの状態と保存済みデータを確認しています…');
    try {
      await api('/api/health');
      const [inbox, insights, experiments, drafts, history] = await Promise.all([
        api('/api/inbox?limit=100'),
        api('/api/insights?limit=100'),
        api('/api/experiments'),
        api('/api/x-drafts'),
        api('/api/processing-history?limit=100'),
      ]);
      state.connected = true;
      state.data.inbox = asArray(asRecord(inbox).items);
      state.data.insights = asArray(asRecord(insights).items);
      state.data.experiments = asArray(asRecord(experiments).items);
      state.data.drafts = asArray(asRecord(drafts).items);
      state.data.history = asArray(asRecord(history).items);
      connection.hidden = true;
      renderAll();
      setStatus('ローカルに保存済みのデータを更新しました。新しい収集・分析・下書き生成は行っていません。', 'success');
    } catch (error) {
      state.connected = false;
      connection.hidden = false;
      setStatus(errorMessage(error), 'error');
    } finally {
      state.busy = wasBusy;
      refreshButton.disabled = false;
    }
  }

  function setView(view, focusTab = false) {
    for (const tab of tabs) {
      const selected = tab.dataset.rdView === view;
      tab.setAttribute('aria-selected', String(selected));
      if (selected && focusTab) tab.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.rdPanel !== view;
    }
  }

  function queueButton({ title, metaLeft, metaRight, selected, onClick, statusValue }) {
    const button = create('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(selected));
    const titleElement = create('span', 'rd-queue-title', title);
    const meta = create('span', 'rd-queue-meta');
    const left = create('span', '', metaLeft);
    const right = create('span', 'rd-badge', metaRight);
    if (statusValue) right.dataset.status = statusValue;
    meta.append(left, right);
    button.append(titleElement, meta);
    button.addEventListener('click', onClick);
    return button;
  }

  function replaceQueue(id, children, empty) {
    const target = byId(id);
    target.replaceChildren(...children);
    if (children.length === 0) target.append(create('p', 'rd-empty', empty));
  }

  function updateCount(id, count, label) {
    byId(id).textContent = `${String(count)} ${label}`;
  }

  function renderInbox() {
    const items = state.data.inbox;
    updateCount('rd-inbox-count', items.length, 'items');
    replaceQueue(
      'rd-inbox-list',
      items.map((value) => {
        const item = asRecord(value);
        return queueButton({
          title: text(item.title),
          metaLeft: text(item.author),
          metaRight: text(item.sourceType),
          selected: false,
          onClick: () => {
            setStatus(`Inbox item: ${text(item.title)}。分析済みの項目は Ranked Insights から確認できます。`);
          },
        });
      }),
      'まだ保存済みのInbox項目はありません。明示的にJSONを取り込むか、既存DBを更新してください。',
    );
  }

  function renderInsights() {
    const insights = state.data.insights;
    updateCount('rd-insight-count', insights.length, 'items');
    replaceQueue(
      'rd-insight-list',
      insights.map((value) => {
        const ranked = asRecord(value);
        const analysis = asRecord(ranked.analysis);
        const ranking = asRecord(ranked.ranking);
        const id = text(analysis.id, '');
        return queueButton({
          title: text(analysis.summary, text(analysis.primaryCategory)),
          metaLeft: text(analysis.primaryCategory),
          metaRight: `${number(ranking.overallScore)} pts`,
          selected: id === state.selected.insightId,
          onClick: () => void selectInsight(id),
        });
      }),
      'まだInsightはありません。Inbox取込後に、明示的に更新してください。',
    );
  }

  function renderExperiments() {
    const experiments = state.data.experiments;
    updateCount('rd-experiment-count', experiments.length, 'items');
    replaceQueue(
      'rd-experiment-list',
      experiments.map((value) => {
        const experiment = asRecord(value);
        const id = text(experiment.id, '');
        const statusValue = text(experiment.status, 'unknown');
        return queueButton({
          title: text(experiment.title),
          metaLeft: text(experiment.estimatedEffort),
          metaRight: statusValue,
          statusValue,
          selected: id === state.selected.experimentId,
          onClick: () => void selectExperiment(id),
        });
      }),
      'まだ提案済みの実験はありません。Insightの詳細から小さな実験を提案できます。',
    );
  }

  function renderDrafts() {
    const drafts = state.data.drafts;
    updateCount('rd-draft-count', drafts.length, 'items');
    replaceQueue(
      'rd-draft-list',
      drafts.map((value) => {
        const draft = asRecord(value);
        const id = text(draft.id, '');
        const statusValue = text(draft.status, 'unknown');
        return queueButton({
          title: text(draft.hook),
          metaLeft: text(draft.evidenceScope),
          metaRight: statusValue,
          statusValue,
          selected: id === state.selected.draftId,
          onClick: () => void selectDraft(id),
        });
      }),
      'まだX下書きはありません。Insightの詳細で、明示的に生成できます。',
    );
  }

  function renderHistory() {
    const history = state.data.history;
    updateCount('rd-history-count', history.length, 'runs');
    const target = byId('rd-history-list');
    target.replaceChildren();
    if (history.length === 0) {
      target.append(create('p', 'rd-empty', 'まだローカルの処理履歴はありません。手動操作の後にここへ記録されます。'));
      return;
    }
    for (const value of history) {
      const run = asRecord(value);
      const item = create('div', 'rd-history-item');
      item.append(
        create('span', '', formatDate(run.startedAt)),
        create('span', 'rd-badge', text(run.status)),
        create('strong', '', `${text(run.operation)} / ${text(run.sourceOrProvider)}`),
        create('b', '', `+${number(run.insertedCount, '0')} / !${number(run.failedCount, '0')}`),
      );
      const badge = item.querySelector('.rd-badge');
      if (badge) badge.dataset.status = text(run.status, 'unknown');
      target.append(item);
    }
  }

  function detailField(label, value) {
    const field = create('div');
    field.append(create('strong', '', label), create('span', '', value));
    return field;
  }

  function renderInsightDetail() {
    const target = byId('rd-insight-detail');
    const form = byId('rd-experiment-form');
    const draftForm = byId('rd-draft-generate-form');
    const detail = state.details.insight;
    if (detail === null) {
      target.className = 'rd-empty-detail';
      target.textContent = '更新後、左のInsightを選択すると要約・スコア・根拠を確認できます。';
      form.hidden = true;
      draftForm.hidden = true;
      byId('rd-insight-status').textContent = 'SELECT ONE';
      return;
    }
    const record = asRecord(detail);
    const analysis = asRecord(record.analysis);
    const ranking = asRecord(record.ranking);
    const source = asRecord(record.sourceItem);
    target.className = 'rd-detail';
    target.replaceChildren();
    target.append(create('h3', '', text(analysis.summary)));
    const scores = create('div', 'rd-score-grid');
    for (const [label, key] of [
      ['RELEVANCE', 'relevance'],
      ['NOVELTY', 'novelty'],
      ['ACTION', 'actionability'],
      ['AUTHOR', 'authorCredibility'],
    ]) {
      const score = asRecord(ranking[key]);
      const cell = create('div', 'rd-score');
      cell.append(create('span', '', label), create('b', '', number(score.score)));
      scores.append(cell);
    }
    target.append(scores);
    const grid = create('div', 'rd-detail-grid');
    grid.append(
      detailField('WHY IT MATTERS', text(analysis.whyItMatters)),
      detailField('WORK USE', text(analysis.workUse)),
      detailField('FIRST EXPERIMENT', text(analysis.suggestedFirstExperiment)),
      detailField('SOURCE', `${text(source.title)} / ${text(source.author)}`),
    );
    target.append(grid);
    const claims = asArray(analysis.claims);
    if (claims.length > 0) {
      const claimSection = create('section');
      claimSection.append(create('h4', '', 'CLAIMS / 根拠の区分'));
      const list = create('ul');
      for (const claimValue of claims) {
        const claim = asRecord(claimValue);
        list.append(create('li', '', `${text(claim.claimClass)}: ${text(claim.text)}`));
      }
      claimSection.append(list);
      target.append(claimSection);
    }
    const analysisId = text(analysis.id, '');
    byId('rd-insight-status').textContent = `${number(ranking.overallScore)} PTS`;
    byId('rd-experiment-analysis-id').value = analysisId;
    byId('rd-experiment-title').value = `検証: ${text(analysis.suggestedFirstExperiment, text(analysis.primaryCategory))}`;
    byId('rd-experiment-hypothesis').value = text(analysis.suggestedFirstExperiment, 'この小さな検証で次の判断に必要な根拠を得られる。');
    byId('rd-experiment-value').value = text(analysis.workUse, '作業への適用可能性を確認する。');
    byId('rd-experiment-effort').value = '20分';
    byId('rd-experiment-step').value = text(analysis.suggestedFirstExperiment, '最小の一歩を記録する。');
    byId('rd-experiment-tools').value = 'Node.js, SQLite';
    byId('rd-experiment-risk').value = text(asArray(analysis.risksAndLimitations)[0], '合成データは実運用を完全には再現しない。');
    byId('rd-experiment-success').value = '小さな検証結果と根拠をローカルに記録できる。';
    byId('rd-experiment-verification').value = '実験状態と結果をローカルAPIから再読込して確認する。';
    const experimentSelect = byId('rd-draft-experiment');
    experimentSelect.replaceChildren();
    const noExperiment = create('option', '', 'なし（ソース根拠のみ）');
    noExperiment.value = '';
    experimentSelect.append(noExperiment);
    for (const experimentValue of state.data.experiments) {
      const experiment = asRecord(experimentValue);
      if (
        experiment.sourceAnalysisId === analysisId &&
        experiment.status === 'completed'
      ) {
        const option = create('option', '', text(experiment.title));
        option.value = text(experiment.id, '');
        experimentSelect.append(option);
      }
    }
    form.hidden = false;
    draftForm.hidden = false;
  }

  function renderExperimentDetail() {
    const target = byId('rd-experiment-detail');
    const actions = byId('rd-experiment-actions');
    const decisionForm = byId('rd-experiment-decision-form');
    const completionForm = byId('rd-completion-form');
    const detail = state.details.experiment;
    actions.replaceChildren();
    if (detail === null) {
      target.className = 'rd-empty-detail';
      target.textContent = '実験を選択すると状態・履歴・学びを確認できます。';
      byId('rd-experiment-status').textContent = 'SELECT ONE';
      decisionForm.hidden = true;
      completionForm.hidden = true;
      return;
    }
    const record = asRecord(detail);
    const experiment = asRecord(record.experiment);
    const statusValue = text(experiment.status, 'unknown');
    target.className = 'rd-detail';
    target.replaceChildren(create('h3', '', text(experiment.title)));
    const grid = create('div', 'rd-detail-grid');
    grid.append(
      detailField('HYPOTHESIS', text(experiment.hypothesis)),
      detailField('EXPECTED VALUE', text(experiment.expectedValue)),
      detailField('SMALLEST FIRST STEP', text(experiment.smallestFirstStep)),
      detailField('SUCCESS CRITERIA', text(experiment.successCriteria)),
      detailField('VERIFICATION', text(experiment.verificationMethod)),
      detailField('RISK', text(experiment.risk)),
    );
    target.append(grid);
    const runs = asArray(record.runs);
    if (runs.length > 0) {
      const section = create('section');
      section.append(create('h4', '', 'RECORDED RESULT'));
      const list = create('ul');
      for (const runValue of runs) {
        const run = asRecord(runValue);
        list.append(create('li', '', `${text(run.result)} / 根拠: ${text(run.verificationEvidence)}`));
      }
      section.append(list);
      target.append(section);
    }
    const learning = asRecord(record.learning);
    if (Object.keys(learning).length > 0) {
      const section = create('section');
      section.append(create('h4', '', 'LEARNING'));
      const list = create('ul');
      list.append(create('li', '', `仮説: ${text(learning.hypothesisSupport)}`));
      list.append(create('li', '', text(learning.reusableKnowledge)));
      if (typeof learning.nextExperiment === 'string') list.append(create('li', '', `次: ${learning.nextExperiment}`));
      section.append(list);
      target.append(section);
    }
    const events = asArray(record.events);
    if (events.length > 0) {
      const section = create('section');
      section.append(create('h4', '', 'STATE HISTORY'));
      const list = create('ul');
      for (const eventValue of events) {
        const event = asRecord(eventValue);
        list.append(create('li', '', `${formatDate(event.createdAt)} → ${text(event.toStatus)}${typeof event.reason === 'string' ? ` (${event.reason})` : ''}`));
      }
      section.append(list);
      target.append(section);
    }
    byId('rd-experiment-status').textContent = statusValue.toUpperCase();
    byId('rd-decision-experiment-id').value = text(experiment.id, '');
    byId('rd-completion-experiment-id').value = text(experiment.id, '');
    const addAction = (label, action) => {
      const button = create('button', 'secondary-button', label);
      button.type = 'button';
      button.addEventListener('click', () => void transitionExperiment(action));
      actions.append(button);
    };
    if (statusValue === 'proposed' || statusValue === 'blocked') addAction('承認する', 'approve');
    if (statusValue === 'approved') addAction('開始する', 'start');
    decisionForm.hidden = !['proposed', 'approved', 'in_progress'].includes(statusValue);
    completionForm.hidden = statusValue !== 'in_progress';
  }

  function renderDraftDetail() {
    const target = byId('rd-draft-detail');
    const form = byId('rd-draft-edit-form');
    const detail = state.details.draft;
    if (detail === null) {
      target.className = 'rd-empty-detail';
      target.textContent = '下書きを選択すると、根拠範囲とレビュー履歴を確認できます。';
      byId('rd-draft-status').textContent = 'SELECT ONE';
      form.hidden = true;
      return;
    }
    const record = asRecord(detail);
    const draft = asRecord(record.draft);
    const statusValue = text(draft.status, 'unknown');
    target.className = 'rd-detail';
    target.replaceChildren(create('h3', '', text(draft.hook)));
    const grid = create('div', 'rd-detail-grid');
    grid.append(
      detailField('EVIDENCE SCOPE', text(draft.evidenceScope)),
      detailField('CHARACTERS', number(draft.characterCount)),
      detailField('RELATED INSIGHT', text(draft.relatedAnalysisId)),
      detailField('RELATED EXPERIMENT', text(draft.relatedExperimentId)),
    );
    target.append(grid);
    const provenance = asArray(draft.provenance);
    if (provenance.length > 0) {
      const section = create('section');
      section.append(create('h4', '', 'EVIDENCE PROVENANCE'));
      const list = create('ul');
      for (const evidenceValue of provenance) {
        const evidence = asRecord(evidenceValue);
        list.append(create('li', '', `${text(evidence.kind)}: ${text(evidence.text)}`));
      }
      section.append(list);
      target.append(section);
    }
    const events = asArray(record.events);
    if (events.length > 0) {
      const section = create('section');
      section.append(create('h4', '', 'REVIEW HISTORY'));
      const list = create('ul');
      for (const eventValue of events) {
        const event = asRecord(eventValue);
        list.append(create('li', '', `${formatDate(event.createdAt)} → ${text(event.toStatus)}${typeof event.reason === 'string' ? ` (${event.reason})` : ''}`));
      }
      section.append(list);
      target.append(section);
    }
    byId('rd-draft-status').textContent = statusValue.toUpperCase();
    byId('rd-draft-id').value = text(draft.id, '');
    byId('rd-draft-hook').value = text(draft.hook, '');
    byId('rd-draft-body').value = text(draft.body, '');
    byId('rd-draft-takeaway').value = text(draft.keyTakeaway, '');
    byId('rd-draft-links').value = asArray(draft.sourceLinks).filter((item) => typeof item === 'string').join('\n');
    byId('rd-draft-review').hidden = statusValue !== 'draft';
    byId('rd-draft-approve').hidden = statusValue !== 'needs_review';
    const editable = statusValue !== 'published';
    for (const control of form.querySelectorAll('textarea, button[type="submit"]')) {
      control.disabled = !editable;
    }
    form.hidden = false;
  }

  function renderAll() {
    renderInbox();
    renderInsights();
    renderExperiments();
    renderDrafts();
    renderHistory();
    renderInsightDetail();
    renderExperimentDetail();
    renderDraftDetail();
  }

  async function selectInsight(id) {
    if (!id) return;
    state.selected.insightId = id;
    state.details.insight = null;
    renderInsights();
    renderInsightDetail();
    byId('rd-insight-status').textContent = 'LOADING…';
    try {
      const detail = await api(`/api/insights/${encodeURIComponent(id)}`);
      if (!isCurrentSelection('insightId', id)) return;
      if (responseEntityId(detail, 'analysis') !== id) {
        throw new Error('API: 返却されたInsightのIDが選択内容と一致しません。');
      }
      state.details.insight = detail;
      renderInsightDetail();
      setStatus('Insight詳細を更新しました。実験提案・下書き生成は、下の明示操作でのみ実行されます。');
    } catch (error) {
      if (!isCurrentSelection('insightId', id)) return;
      state.details.insight = null;
      renderInsightDetail();
      setStatus(errorMessage(error), 'error');
    }
  }

  async function selectExperiment(id) {
    if (!id) return;
    state.selected.experimentId = id;
    state.details.experiment = null;
    renderExperiments();
    renderExperimentDetail();
    byId('rd-experiment-status').textContent = 'LOADING…';
    try {
      const detail = await api(`/api/experiments/${encodeURIComponent(id)}`);
      if (!isCurrentSelection('experimentId', id)) return;
      if (responseEntityId(detail, 'experiment') !== id) {
        throw new Error('API: 返却された実験のIDが選択内容と一致しません。');
      }
      state.details.experiment = detail;
      renderExperimentDetail();
      setStatus('実験詳細を更新しました。状態変更と結果記録は、明示操作でのみ実行されます。');
    } catch (error) {
      if (!isCurrentSelection('experimentId', id)) return;
      state.details.experiment = null;
      renderExperimentDetail();
      setStatus(errorMessage(error), 'error');
    }
  }

  async function selectDraft(id) {
    if (!id) return;
    state.selected.draftId = id;
    state.details.draft = null;
    renderDrafts();
    renderDraftDetail();
    byId('rd-draft-status').textContent = 'LOADING…';
    try {
      const detail = await api(`/api/x-drafts/${encodeURIComponent(id)}`);
      if (!isCurrentSelection('draftId', id)) return;
      if (responseEntityId(detail, 'draft') !== id) {
        throw new Error('API: 返却された下書きのIDが選択内容と一致しません。');
      }
      state.details.draft = detail;
      renderDraftDetail();
      setStatus('X下書きの根拠とレビュー履歴を更新しました。コピー用で、人間レビューが必須です。');
    } catch (error) {
      if (!isCurrentSelection('draftId', id)) return;
      state.details.draft = null;
      renderDraftDetail();
      setStatus(errorMessage(error), 'error');
    }
  }

  async function mutation(action, work) {
    if (state.busy) return;
    state.busy = true;
    setStatus(`${action}をローカルに記録しています…`);
    try {
      const result = await work();
      await refreshData(true);
      setStatus(`${action}をローカルに記録しました。`, 'success');
      return result;
    } catch (error) {
      setStatus(errorMessage(error), 'error');
      return undefined;
    } finally {
      state.busy = false;
    }
  }

  async function transitionExperiment(action) {
    const detail = asRecord(state.details.experiment);
    const experiment = asRecord(detail.experiment);
    const id = text(experiment.id, '');
    if (!id) return;
    const result = await mutation(`実験を${action === 'approve' ? '承認' : '開始'}`, () =>
      api(`/api/experiments/${encodeURIComponent(id)}/${action}`, jsonOptions('POST', {})),
    );
    if (result !== undefined) await selectExperiment(id);
  }

  function requiredFormValue(form, name) {
    const field = form.elements.namedItem(name);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
      throw new Error(`フォーム項目 ${name} が見つかりません。`);
    }
    return field.value.trim();
  }

  function optionalFormValue(form, name) {
    const value = requiredFormValue(form, name);
    return value === '' ? undefined : value;
  }

  document.querySelector('#rd-import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = byId('rd-import-json');
    let payload;
    try {
      payload = JSON.parse(input.value);
    } catch {
      setStatus('JSONの構文を確認してください。取込はまだ実行されていません。', 'error');
      input.focus();
      return;
    }
    void mutation('Inbox取込と分析', async () => {
      const result = await api('/api/inbox/import', jsonOptions('POST', payload));
      form.reset();
      return result;
    });
  });

  document.querySelector('#rd-fill-sample').addEventListener('click', () => {
    byId('rd-import-json').value = JSON.stringify({
      items: [
        {
          sourceType: 'manual',
          sourceExternalId: 'synthetic-ui-sample-001',
          title: '合成サンプル: ローカル実験の候補',
          author: 'Synthetic Local Author',
          content: 'これは実在の収集データではない合成サンプルです。小さなローカル検証を記録します。',
          sourceMetadata: { synthetic: true, importedFrom: 'rd-ui-sample' },
        },
      ],
    }, null, 2);
    setStatus('合成サンプルを入力しました。まだ取込・分析は実行されていません。');
  });

  document.querySelector('#rd-experiment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const analysisId = requiredFormValue(form, 'analysisId');
    if (!analysisId) return;
    const tools = requiredFormValue(form, 'requiredTools')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const payload = {
      title: requiredFormValue(form, 'title'),
      hypothesis: requiredFormValue(form, 'hypothesis'),
      expectedValue: requiredFormValue(form, 'expectedValue'),
      smallestFirstStep: requiredFormValue(form, 'smallestFirstStep'),
      requiredTools: tools,
      estimatedEffort: requiredFormValue(form, 'estimatedEffort'),
      risk: requiredFormValue(form, 'risk'),
      successCriteria: requiredFormValue(form, 'successCriteria'),
      verificationMethod: requiredFormValue(form, 'verificationMethod'),
    };
    void mutation('実験提案', () =>
      api(`/api/insights/${encodeURIComponent(analysisId)}/experiments`, jsonOptions('POST', payload)),
    );
  });

  document.querySelector('#rd-draft-generate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const analysisId = state.selected.insightId;
    if (!analysisId) return;
    const form = event.currentTarget;
    const experimentId = optionalFormValue(form, 'experimentId');
    const payload = experimentId === undefined ? {} : { experimentId };
    void (async () => {
      const result = await mutation('X下書き生成', () =>
        api(`/api/insights/${encodeURIComponent(analysisId)}/x-drafts`, jsonOptions('POST', payload)),
      );
      const draft = asRecord(asRecord(result).draft);
      const id = text(draft.id, '');
      if (id) {
        setView('drafts');
        await selectDraft(id);
      }
    })();
  });

  document.querySelector('#rd-experiment-decision-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = requiredFormValue(form, 'experimentId');
    const action = requiredFormValue(form, 'action');
    const reason = requiredFormValue(form, 'reason');
    if (!id || !['block', 'reject'].includes(action)) return;
    void (async () => {
      const result = await mutation(action === 'block' ? '実験のブロック' : '実験の却下', () =>
        api(`/api/experiments/${encodeURIComponent(id)}/${action}`, jsonOptions('POST', { reason })),
      );
      if (result !== undefined) {
        form.reset();
        await selectExperiment(id);
      }
    })();
  });

  document.querySelector('#rd-completion-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = requiredFormValue(form, 'experimentId');
    if (!id) return;
    const payload = {
      result: requiredFormValue(form, 'result'),
      verificationEvidence: requiredFormValue(form, 'verificationEvidence'),
      learned: requiredFormValue(form, 'learned'),
      nextDecision: requiredFormValue(form, 'nextDecision'),
      hypothesisSupport: requiredFormValue(form, 'hypothesisSupport'),
      reusableKnowledge: requiredFormValue(form, 'reusableKnowledge'),
      ...(optionalFormValue(form, 'nextExperiment') === undefined ? {} : { nextExperiment: optionalFormValue(form, 'nextExperiment') }),
      ...(optionalFormValue(form, 'publishableFirstHandExperience') === undefined ? {} : { publishableFirstHandExperience: optionalFormValue(form, 'publishableFirstHandExperience') }),
    };
    void (async () => {
      const result = await mutation('実験結果', () =>
        api(`/api/experiments/${encodeURIComponent(id)}/complete`, jsonOptions('POST', payload)),
      );
      if (result !== undefined) await selectExperiment(id);
    })();
  });

  document.querySelector('#rd-draft-edit-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = requiredFormValue(form, 'draftId');
    if (!id) return;
    const sourceLinks = requiredFormValue(form, 'sourceLinks')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    const payload = {
      hook: requiredFormValue(form, 'hook'),
      body: requiredFormValue(form, 'body'),
      keyTakeaway: requiredFormValue(form, 'keyTakeaway'),
      sourceLinks,
    };
    void (async () => {
      const result = await mutation('X下書きの変更', () =>
        api(`/api/x-drafts/${encodeURIComponent(id)}`, jsonOptions('PATCH', payload)),
      );
      if (result !== undefined) await selectDraft(id);
    })();
  });

  async function transitionDraft(action) {
    const detail = asRecord(state.details.draft);
    const draft = asRecord(detail.draft);
    const id = text(draft.id, '');
    if (!id) return;
    const actionName = action === 'review' ? 'X下書きをレビューへ送付' : 'X下書きの人間レビュー承認';
    const result = await mutation(actionName, () =>
      api(`/api/x-drafts/${encodeURIComponent(id)}/${action}`, jsonOptions('POST', {})),
    );
    if (result !== undefined) await selectDraft(id);
  }

  document.querySelector('#rd-draft-review').addEventListener('click', () => {
    void transitionDraft('review');
  });
  document.querySelector('#rd-draft-approve').addEventListener('click', () => {
    void transitionDraft('approve');
  });
  document.querySelector('#rd-draft-copy').addEventListener('click', () => {
    const detail = asRecord(state.details.draft);
    const draft = asRecord(detail.draft);
    const copyText = [text(draft.hook, ''), text(draft.body, ''), text(draft.keyTakeaway, '')]
      .filter(Boolean)
      .join('\n\n');
    if (!copyText) return;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      setStatus('このブラウザではクリップボードへのコピーを利用できません。下書き欄から手動でコピーしてください。', 'error');
      return;
    }
    void navigator.clipboard.writeText(copyText).then(
      () => setStatus('X下書きをローカルのクリップボードへコピーしました。投稿は行っていません。', 'success'),
      () => setStatus('コピーできませんでした。下書き欄から手動でコピーしてください。', 'error'),
    );
  });

  for (const button of openButtons) {
    button.addEventListener('click', (event) => {
      launchButton = event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : null;
      dashboardGrid.hidden = true;
      commandBar.hidden = true;
      root.hidden = false;
      setView('inbox');
      byId('rd-refresh').focus();
    });
  }
  backButton.addEventListener('click', () => {
    root.hidden = true;
    dashboardGrid.hidden = false;
    commandBar.hidden = false;
    const fallback = document.querySelector('#open-rd-intelligence');
    const target = launchButton !== null && document.contains(launchButton)
      ? launchButton
      : fallback;
    if (target instanceof HTMLElement) target.focus();
  });
  refreshButton.addEventListener('click', () => {
    void refreshData();
  });
  for (const tab of tabs) {
    tab.addEventListener('click', () => setView(tab.dataset.rdView));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      setView(next.dataset.rdView, true);
    });
  }

  renderAll();
})();
