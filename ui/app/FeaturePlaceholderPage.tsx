import { Link } from "react-router-dom";
import type { FeatureDefinition } from "../features/dashboard/feature-definitions.js";

interface FeaturePlaceholderPageProps {
  readonly activePlaceholder?: boolean;
  readonly feature: FeatureDefinition;
}

export function FeaturePlaceholderPage({
  activePlaceholder = false,
  feature,
}: FeaturePlaceholderPageProps) {
  return (
    <section className="placeholder-page" aria-labelledby="feature-page-title">
      <Link className="back-link" to="/">
        ← Dashboard
      </Link>
      <div className="placeholder-panel">
        <span className="feature-glyph" aria-hidden="true">
          {feature.glyph}
        </span>
        <p className="page-eyebrow">{feature.eyebrow}</p>
        <h1 id="feature-page-title">{feature.title}</h1>
        <p>{feature.description}</p>
        <div className="placeholder-state">
          <span className={activePlaceholder ? "status-active" : "status-planned"}>
            {activePlaceholder ? "UI MIGRATION IN PROGRESS" : "PLANNED"}
          </span>
          <small>
            {activePlaceholder
              ? "既存のローカル機能をReact画面へ移行しています。"
              : "Feature境界を保ったまま、必要になった段階で実装します。"}
          </small>
        </div>
      </div>
    </section>
  );
}
