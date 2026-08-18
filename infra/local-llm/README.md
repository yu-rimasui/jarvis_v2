# Local LLM boundary

R&D Intelligence PH1は、ホスト上で別途管理されるOllamaへ`http://127.0.0.1:11434`で接続します。

- JarvisはOllamaを起動・停止しません。
- Jarvisはモデルをpull・削除・訓練しません。
- 既定モデルは`qwen3-vl:8b`です。
- モデルやruntimeの導入は、ユーザーの明示許可を得た別作業として行います。
- 接続状態は`GET /api/readiness`で確認できます。

将来、LoRAやデータセット作成を導入する場合も、アプリコードとは分けてこの`infra/local-llm/`配下に再現可能な設定だけを置き、モデル本体・個人データ・秘密情報はGit管理しません。
