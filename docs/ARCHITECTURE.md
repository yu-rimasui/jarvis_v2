# Architecture profiles

このリポジトリはモジュラーモノリスです。ルート直下を番号付きディレクトリにせず、責務が名前から分かる境界を使います。`ui/`にはブラウザUI、`src/`にはサーバーとアプリケーションコードを置くため、ブラウザ側に2つ目の`src`は作りません。

```text
jarvis_v2/
├─ ui/                 React browser UI（ui/app と ui/features）
├─ src/                server / application code
│  ├─ features/        Node.jsのFeature
│  └─ jarvis/          Python application foundation
├─ tests/              Node.js server tests
├─ migrations/         SQLite migrations
├─ fixtures/           合成テストデータ
├─ infra/              将来のLocal LLM runtime設定
├─ ml/                 将来の学習・評価・データ準備コード
├─ data/                ローカルDBや個人データ（Git管理外）
└─ models/             model weights / adapters（Git管理外）
```

`infra/`、`ml/`、`models/`は配置方針であり、必要な実装が発生するまで空の雛形は作りません。

## Browser UI

`ui/`はReact、Vite、React Routerで構成します。

- `ui/app/`: router、App Shell、全体スタイル
- `ui/features/<feature>/`: Feature固有のpage、component、API client、test
- `ui/index.html`: 唯一のHTML entry point
- `dist/ui/`: build成果物。Git管理外

ルート `/` はFeatureカード型ダッシュボードです。各カードは `/rd-intelligence` などのFeature routeへ遷移します。Node.jsのローカルAPIは、宣言済みrouteとbuild assetだけをallowlistで配信し、任意ファイルやsource mapを公開しません。

## Target foundation

新しいPython側の基盤設定は、`.codex/rules`の設計に合わせています。

```text
FastAPI app
  └─ src/jarvis/
      ├─ main.py        アプリケーションの組み立て
      ├─ core/          設定・共通の技術的基盤
      └─ features/      Featureごとの公開境界とユースケース
          ├─ chat/      （実装時に追加）
          ├─ memory/    （実装時に追加）
          └─ tasks/     （実装時に追加）
```

`compose.yaml`は次の3サービスを定義します。

- `app`: Python 3.12、FastAPI、Uvicorn
- `postgres`: 構造化データの原本
- `vector-db`: Qdrantによる意味検索インデックス

接続先は環境変数から注入し、Composeのポートは`127.0.0.1`へ限定しています。

## Transitional boundary

既存のR&D Intelligence MVPは、機能を壊さないためにNode.js／SQLiteのまま維持しています。

- Node.jsのR&D実装は`src/features/rd-intelligence/`に集約し、Python実装との混在を避ける
- SQLiteの既存データを自動的にPostgreSQLへ移行しない
- fake LLMやローカルAPIをPython実装へ自動変換しない
- Reactのbuild成果物は`dist/ui/`へ生成し、Nodeのallowlist経由でのみ配信する

Python foundationは現在、設定・依存・Compose・`/health`の最小境界のみです。R&D機能の移植は、PostgreSQLの原本スキーマ、Repository契約、Vector DBの再インデックス方針を別タスクとして決めてから行います。

`src/jarvis/features/`はFeatureの親パッケージとして先に用意しています。ただし、Chat、Memory、Tasksの空の雛形は作りません。Feature固有のservice、models、repository、routerが必要になった時点で、そのFeature内にだけ追加します。

## Local LLMと学習データ

Local LLMは役割を分けて配置します。

| Path | Responsibility | Git policy |
| --- | --- | --- |
| `infra/local-llm/` | Ollama等のruntime設定、Compose fragment、起動補助 | 秘密を含まない設定だけ追跡 |
| `src/jarvis/features/...` | modelを呼ぶapplication boundaryとprovider | 追跡 |
| `ml/` | fine-tuning、評価、dataset生成コード | コードと合成fixtureだけ追跡 |
| `data/` | 個人データ、ローカルDB、生成dataset | 追跡しない |
| `models/` | model weights、adapter、checkpoint | 追跡しない |

「設置」は`infra/local-llm/`、「アプリからの利用」はFeature内provider、「訓練・評価ロジック」は`ml/`です。個人データやmodel実体をリポジトリへ混ぜないことで、UI／アプリコードのレビューと大容量・機密データの運用を分離します。

## Configuration files

| File | Responsibility |
| --- | --- |
| `pyproject.toml` | Python package、依存、lint/type/test設定 |
| `compose.yaml` | app/PostgreSQL/Qdrantのローカル構成 |
| `Dockerfile` | Python app image |
| `.env.example` | 秘密でないローカル環境変数の例 |
| `src/jarvis/core/config.py` | 環境変数の型付き読み込み |

実際の秘密情報は`.env`へ置き、追跡・ログ出力・イメージへの埋め込みを行いません。
