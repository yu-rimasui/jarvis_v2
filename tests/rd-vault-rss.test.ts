import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RssFeedCollector, RssCollectorError } from "../src/features/rd-intelligence/collectors/rss-collector.js";
import { xWeightedCharacterCount } from "../src/features/rd-intelligence/content/x-character-count.js";
import { OllamaOutputError, OllamaProvider } from "../src/features/rd-intelligence/providers/ollama-provider.js";
import { KnowledgeVault, VaultBoundaryError } from "../src/features/rd-intelligence/vault/knowledge-vault.js";

const temporaryDirectories: string[] = [];

test.after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

test("RSS reads feed metadata only, filters by cutoff, and bounds the result", async () => {
  const entries = Array.from({ length: 12 }, (_, index) => `
    <item><title>Item ${index}</title><link>https://zenn.dev/example/articles/${index}</link>
    <guid>item-${index}</guid><dc:creator>author</dc:creator>
    <pubDate>Wed, 19 Aug 2026 01:${String(index).padStart(2, "0")}:00 GMT</pubDate>
    <description><![CDATA[<p>summary ${index}</p>]]></description></item>`).join("");
  const xml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Zenn</title>${entries}</channel></rss>`;
  const collector = new RssFeedCollector({
    definition: { name: "zenn-ai", sourceType: "zenn", url: "https://zenn.dev/topics/ai/feed" },
    cutoff: new Date("2026-08-19T00:00:00.000Z"),
    limit: 10,
    fetchImplementation: async () => new Response(xml, { status: 200 }),
  });
  const result = await collector.collect();
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0]?.content, "summary 0");
  assert.equal(result.items[0]?.sourceMetadata["feedName"], "zenn-ai");
});

test("broken RSS is reported as a bounded collector failure", async () => {
  const collector = new RssFeedCollector({
    definition: { name: "qiita-ai", sourceType: "qiita", url: "https://qiita.com/tags/AI/feed.atom" },
    cutoff: new Date(0),
    fetchImplementation: async () => new Response("not xml", { status: 200 }),
  });
  await assert.rejects(() => collector.collect(), RssCollectorError);
});

test("X weighted count handles Japanese, emoji, and fixed-length URLs", () => {
  assert.equal(xWeightedCharacterCount("https://example.com/a/very/long/path"), 23);
  assert.equal(xWeightedCharacterCount("日本語😀"), 8);
  assert.ok(xWeightedCharacterCount(`試しました😀 https://example.com/source`) <= 280);
});

test("Ollama invalid structured output retries once and creates no usable result", async () => {
  let calls = 0;
  const provider = new OllamaProvider({
    baseUrl: "http://127.0.0.1:11434",
    model: "qwen3-vl:8b",
    fetchImplementation: async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: { content: "not-json" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    () => provider.analyze({
      id: "source-1", sourceType: "manual", title: "title", author: "author",
      content: "content", contentHash: "hash", collectedAt: "2026-08-19T00:00:00.000Z",
      sourceMetadata: {},
    }),
    OllamaOutputError,
  );
  assert.equal(calls, 2);
});

test("Vault rejects screenshot symlinks even when their target is inside the R&D area", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-vault-"));
  temporaryDirectories.push(root);
  const area = join(root, "03 - AREAS", "RD Intelligence");
  const practiceDirectory = join(area, "02 - 実践ログ");
  const assets = join(area, "Assets");
  mkdirSync(practiceDirectory, { recursive: true });
  mkdirSync(assets, { recursive: true });
  mkdirSync(join(area, "01 - インプット"));
  mkdirSync(join(area, "03 - ポスト下書き"));
  writeFileSync(join(assets, "real.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  symlinkSync(join(assets, "real.png"), join(assets, "linked.png"));
  writeFileSync(join(practiceDirectory, "practice.md"), `---
type: rd-practice
status: in_progress
jarvis_id: experiment-1
experiment_id: experiment-1
hypothesis_support: supported
---
# Practice
## 実施環境
Node.js
## やったこと
手順を実行
## 結果
成功
## エラー・詰まり
なし
## 気付き
再現できた
## 公開可能な一次体験
ローカルで試した
## スクリーンショット
![[linked.png]]
`);
  const vault = new KnowledgeVault({ vaultPath: root, areaPath: "03 - AREAS/RD Intelligence" });
  await assert.rejects(() => vault.readPractice("experiment-1"), VaultBoundaryError);
});
