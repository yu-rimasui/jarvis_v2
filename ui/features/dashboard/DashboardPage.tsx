import { FeatureCard } from "./FeatureCard.js";
import { featureDefinitions } from "./feature-definitions.js";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "long",
  timeZone: "Asia/Tokyo",
});

export function DashboardPage() {
  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <header className="page-heading dashboard-heading">
        <div>
          <p className="page-eyebrow">OVERVIEW / {dateFormatter.format(new Date())}</p>
          <h1 id="dashboard-title">
            お疲れさまです。
            <span>今日は何を進めますか？</span>
          </h1>
        </div>
        <div className="privacy-badge">
          <span aria-hidden="true">●</span>
          <div>
            <strong>LOCAL FIRST</strong>
            <small>外部投稿と自動実行は停止中</small>
          </div>
        </div>
      </header>

      <section className="mission-brief" aria-labelledby="mission-title">
        <div>
          <p className="page-eyebrow">CURRENT MISSION</p>
          <h2 id="mission-title">小さな検証を、説明できる学びに変える。</h2>
          <p>
            R&D Intelligenceでは、根拠の取込から実験、X下書きの人間レビューまでをローカルで進められます。
          </p>
        </div>
        <div className="mission-readout" aria-label="現在のシステム状態">
          <span>01</span>
          <p>
            <strong>ACTIVE FEATURE</strong>
            <small>4 features planned</small>
          </p>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <p className="page-eyebrow">CAPABILITIES</p>
          <h2>Feature modules</h2>
        </div>
        <p>カードを選択すると各Featureのページへ移動します。</p>
      </div>

      <div className="feature-grid">
        {featureDefinitions.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </div>
    </section>
  );
}
