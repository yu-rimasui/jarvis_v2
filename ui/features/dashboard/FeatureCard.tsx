import { Link } from "react-router-dom";
import type { FeatureDefinition } from "./feature-definitions.js";

interface FeatureCardProps {
  readonly feature: FeatureDefinition;
}

export function FeatureCard({ feature }: FeatureCardProps) {
  return (
    <Link className="feature-card" to={feature.path}>
      <div className="feature-card-topline">
        <span className="feature-glyph" aria-hidden="true">
          {feature.glyph}
        </span>
        <span
          className={`feature-status feature-status-${feature.status}`}
          aria-label={feature.status === "active" ? "稼働中" : "準備中"}
        >
          {feature.status === "active" ? "ACTIVE" : "PLANNED"}
        </span>
      </div>
      <div className="feature-card-copy">
        <p>{feature.eyebrow}</p>
        <h2>{feature.title}</h2>
        <span>{feature.description}</span>
      </div>
      <div className="feature-card-footer">
        <div>
          <strong>{feature.metric}</strong>
          <small>{feature.metricLabel}</small>
        </div>
        <span className="feature-open" aria-hidden="true">
          ↗
        </span>
      </div>
    </Link>
  );
}
