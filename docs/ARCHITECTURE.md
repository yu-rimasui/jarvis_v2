# Architecture profiles

このリポジトリは、機能移行中の2つの実装境界を明示的に持ちます。

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
- 既存ダッシュボードのHTML/CSS/JSは`mocks/dashboard/`へ隔離し、Nodeのallowlist経由でのみ配信する

Python foundationは現在、設定・依存・Compose・`/health`の最小境界のみです。R&D機能の移植は、PostgreSQLの原本スキーマ、Repository契約、Vector DBの再インデックス方針を別タスクとして決めてから行います。

`src/jarvis/features/`はFeatureの親パッケージとして先に用意しています。ただし、Chat、Memory、Tasksの空の雛形は作りません。Feature固有のservice、models、repository、routerが必要になった時点で、そのFeature内にだけ追加します。

## Configuration files

| File | Responsibility |
| --- | --- |
| `pyproject.toml` | Python package、依存、lint/type/test設定 |
| `compose.yaml` | app/PostgreSQL/Qdrantのローカル構成 |
| `Dockerfile` | Python app image |
| `.env.example` | 秘密でないローカル環境変数の例 |
| `src/jarvis/core/config.py` | 環境変数の型付き読み込み |

実際の秘密情報は`.env`へ置き、追跡・ログ出力・イメージへの埋め込みを行いません。
