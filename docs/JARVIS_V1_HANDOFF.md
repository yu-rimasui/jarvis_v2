# Jarvis-v1 Handoff

調査日：2026-07-21

この文書は、`Jarvis-v1`から`jarvis_v2`へ引き継ぐ判断材料をまとめたものです。コードを丸ごと移植するための仕様書ではありません。

## 1. Jarvis-v1の出自と目的

Jarvis-v1は、Stanford SAIL / Hazy ResearchのOpenJarvisをベースにしています。OpenJarvisは、個人端末で動くローカルファーストAIの研究・プロダクション基盤を目指す大規模な汎用フレームワークです。

主な思想は次のとおりです。

- ローカルLLMを優先し、必要に応じてクラウドモデルを利用する。
- エージェント、ツール、Memory、Skillsなどを共通部品として提供する。
- 精度だけでなく、レイテンシ、コスト、エネルギー、FLOPsを評価する。
- ローカルの実行Traceから学習・最適化する。

ライセンスはApache License 2.0です。コードを再利用するときは、元のLICENSEと帰属表示を確認してください。

## 2. 規模

調査時点の概数です。

- Git追跡ファイル：約2,033
- Pythonファイル：約1,317
- テストファイル：約652
- Frontendソース：約71
- GitHub Actions Workflow：11

個人用MVPとしては大きく、理解していない機能や運用を削りながら使うより、必要な部分だけを参考にする方が安全です。

## 3. 主な技術構成

### Backend

- Python 3.10以上3.14未満
- CLI：Click
- API候補：FastAPI / Uvicorn
- LLM：OpenAI、Anthropic、Google、LiteLLM、Ollamaやローカル推論系
- Memory：FAISS、ColBERT、BM25、PDF取り込みなどを任意追加
- Agent：Simple、ReAct、Orchestrator、Deep Research、継続実行型など
- その他：Scheduler、Sandbox、MCP、Connectors、Skills、Telemetry、Evaluation、Learning

### Frontend / Desktop

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- React Router
- Vitest
- Tauri 2によるDesktop化

### その他

- Rust / PyO3拡張
- MkDocs
- 多数の外部Channel、Connector、任意依存
- PyPI、Desktop release、自動tagなどの公開基盤

## 4. 既存機能

OpenJarvis本体には、概ね次の機能があります。

- ローカル／クラウドモデルを使うチャット
- モデル選択とルーティング
- 複数方式のエージェント
- Deep Researchと引用
- 会話、Memory、Trace
- Skillsの導入・評価・最適化
- Web検索、ファイル、コード実行などのTools
- Gmail、Calendar、MessagingなどのConnector / Channel
- Scheduled / Continuous Agent
- 音声認識・読み上げ
- Dashboard、ログ、Data Sources、Settings
- Tauri Desktopアプリ
- ベンチマーク、評価、学習、コスト・エネルギー計測

これらは有用な参考実装ですが、Jarvis v2のMVPへ一括で持ち込まない方針です。

## 5. ゆーりが追加した変更

独自変更は、調査時点では次の1コミットです。

```text
8b464abb Add control center UI
```

変更内容：

- `frontend/src/pages/ControlCenterPage.tsx`を追加
- アプリのトップページをControl Centerへ変更
- SidebarへControl Center導線を追加
- HUD風デザインのため`frontend/src/index.css`を拡張

変更量は約967行追加、6行削除です。

Control Centerには次の表示があります。

- Core Intelligence
- Expandable Modules
- Data Ports
- Live Logs
- システム状態、Memory、Agentなどを想定した情報パネル

このUIはJarvis v2の`design/dashboard`におけるデザイン参考資料として利用できます。ただし632行の単一ページをそのまま移植せず、MVPで必要な情報から小さなComponentへ再設計することを推奨します。

## 6. Git状態

調査時点：

- 現在のローカルブランチ：`feat/digital-twin`
- ワークツリー：clean
- 同じ独自コミットを指す参照：`feat/digital-twin`、`ui_design`、`github-new/main`
- upstream：`origin/main`はOpenJarvis本体

つまりControl Center UIのコミットは、ユーザー側リモートの`main`にも既に存在します。一方、`~/.codex`にあるR&D BrainはこのGitリポジトリには含まれません。

## 7. GitHub Actionsが勝手に動く理由

Jarvis-v1には11個のWorkflowがあります。特に次の2つが毎日06:00 UTC、つまり日本時間15:00に定期実行されます。

- `installer-integration.yml`
- `track-clones.yml`

このほか、mainへのpush、Pull Request、tag、issue/commentなどを契機に以下が動きます。

- Python CI
- Bash test
- Frontend CI
- Desktop build / release
- Docs deploy
- PyPI publish
- 自動tag
- Claudeによるissue対応・review
- 自動assign

Jarvis v2ではこれらをコピーしません。CIが必要になった時点で、Pull Requestまたは手動実行の最小Workflowから始めます。

## 8. Jarvis v2へ引き継ぐもの

### 思想として引き継ぐ

- Local first
- Cloud APIは必要な場合だけ使う
- Model providerを交換可能にする
- MemoryとTraceをユーザーが確認・管理できる
- Agentの行動を記録し、検証可能にする
- 将来的なSkills / Tools拡張を妨げない境界設計

### 参考実装として見る

- Chat UIとStreaming処理
- Model一覧取得と選択UI
- Memory Browser
- Data Sources
- Agent Events / Logs
- Control Center UI
- Local / Cloud providerの境界

### MVPへ持ち込まない

- 既存コードベース全体
- 全Agent方式
- Evaluation / Mining / Learning基盤
- Rust拡張とDesktop release基盤
- 多数のMessaging Channel / Connector
- Telemetryとランキング共有
- SchedulerとContinuous Agent
- 自動tag、PyPI publish、clone trackingなどのWorkflow

## 9. R&D BrainとCodex Loop

Jarvis-v1リポジトリとは別に、Codex環境へ次が導入されています。

- Codex Loop Skill：`~/.codex/skills/codex-loop`
- R&D Brain Skill：`~/.codex/skills/rd-brain`
- R&D Knowledge Base：`~/.codex/rd-brain`

これらはJarvis-v1をpushしても保存されません。

- Codex Loopは長期作業の継続制御と`.codex/loop/`での進捗追跡に使う。
- R&D BrainはEvidenceからPain、Opportunity、Idea、Critiqueを蓄積する。
- R&D Brainは独自Loop Engineを持たず、必要な場合だけCodex Loopを使う。
- 個人情報を含むKnowledge Baseは、公開リポジトリへ入れない。

## 10. Jarvis v2で最初に決めること

実装前に次を決めると、再び過剰な構成になるのを防げます。

1. 最初のユーザーストーリー：何を記憶し、どの場面で役立つか。
2. データ境界：ローカル保存するものとクラウド送信可能なもの。
3. 最初のLLM接続：Ollamaのみか、OpenAI API fallbackも含めるか。
4. 最初の記憶形式：SQLiteかMarkdownか。
5. UI：Webのみから始めるか、Desktop化まで含めるか。
6. MVPの合格条件：デモではなく、何回使えたら価値を確認できるか。

## 11. 推奨する最初の縦方向スライス

```text
チャット入力
  -> ローカルまたは許可済みLLMで回答
  -> ユーザーが「記憶する」を選ぶ
  -> ローカルへ保存
  -> 次の会話で検索
  -> 参照した記憶を表示
  -> ユーザーが訂正または削除
```

この一連の体験が安定してから、Digital Twin、Dashboard、IoTへ広げます。
