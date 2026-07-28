# 検証と報告

変更対象に応じて必要な検証を選ぶ。コマンドは実行前に `pyproject.toml`、Compose設定、テスト構成を確認して選択し、存在しない設定を前提に実行しない。

代表例は次のとおり。

```bash
ruff format --check .
ruff check .
mypy src
pytest
docker compose config
```

| 変更対象 | 確認すること |
| --- | --- |
| Python実装 | format、lint、type check、関連するUnit Test |
| Repository・DB・migration | Integration Test、migrationの適用/戻し方、原本とインデックスの整合性 |
| CLI/API | 共通Serviceの利用、Contract Test、必要なE2E Test |
| LLM処理 | Structured Output、検証失敗時、fallback、実APIを使わないテスト |
| Compose・設定 | `docker compose config`、healthcheck、起動依存、環境変数とsecretの扱い |
| Feature変更 | 公開境界、Feature間import、循環依存、Feature固有ロジックの配置 |

変更後には、secret・個人情報・会話や記憶の本文が、コード、fixture、ログ設定、差分に混入していないことも確認する。

報告には、実行した検証、成功した検証、実行できなかった検証と理由、未解決の警告またはエラー、アーキテクチャ上の影響、残るリスクを含める。
