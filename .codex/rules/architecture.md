# アーキテクチャ

## 方針

Jarvis は、CLIから日常のタスクと情報検索を支援するローカルファーストのパーソナルAIアシスタントである。初期段階は単一のデプロイ可能なアプリケーションとして動かしつつ、内部では Feature ごとに責務と依存を分けるモジュラーモノリスを採用する。

モジュラーモノリスは、インフラと運用を小さく保ったまま、Featureの独立性を検証できるため採用する。Package by Feature は、変更理由・ユースケース・テストを近接させ、技術レイヤー横断の変更を避けるため採用する。

## 基本構成

```text
src/jarvis/
├── main.py
├── core/
└── features/
    ├── chat/
    ├── memory/
    └── tasks/
```

`main.py` はアプリケーションの組み立てとエントリーポイントの登録だけを担う。CLI と API は利用者向けの入出力層であり、同じ Feature Service を呼び出す。`core` は設定、共通の外部接続、横断的な例外・ログなど、Featureに属さない技術的基盤を担う。`features` は各ユースケース、データ所有、Feature固有の入出力変換を担う。

次の技術レイヤー別トップレベル構成は作らない。

```text
controllers/
services/
repositories/
models/
```

## 依存方向

```text
CLI / API
    ↓
Feature Router
    ↓
Feature Service
    ↓
Repository / External Adapter
    ↓
PostgreSQL / Vector DB / LLM
```

- 入出力層は Feature Service へ依存し、Service は FastAPI・Typer固有の型へ依存しない。
- Feature は必要な共通技術だけを `core` から利用できる。`core` は Featureのユースケースや個別モデルを知らない。
- Feature間は公開インターフェースを通じて連携する。相手の内部実装、Repository、内部DBモデルを直接参照しない。
- 循環依存は作らない。双方向連携が必要に見える場合は、責務の見直し、呼び出し元での合成、または明示的な公開契約を検討する。
- PostgreSQL、Vector DB、LLMなどの外部サービスは Adapter / Repository の外側に置き、Feature Serviceが接続詳細を持たないようにする。

## 拡張の判断

将来に切り出せるよう、Featureの公開境界とデータ所有を明確にする。ただし、独立デプロイ、メッセージブローカー、分散トランザクション、共通イベント基盤は、現在の単一プロセスでは必要になった時点で導入を判断する。

代表的な違反は、routerへの主要ロジック配置、Feature固有ロジックの`core`集約、他FeatureのRepository直接操作、技術レイヤー別トップレベル構成、循環importである。
