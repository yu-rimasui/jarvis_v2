import { Route, Routes } from "react-router-dom";
import { DashboardPage } from "../features/dashboard/DashboardPage.js";
import { featureDefinitions } from "../features/dashboard/feature-definitions.js";
import { RdIntelligencePage } from "../features/rd-intelligence/RdIntelligencePage.js";
import { AppShell } from "./AppShell.js";
import { FeaturePlaceholderPage } from "./FeaturePlaceholderPage.js";
import { NotFoundPage } from "./NotFoundPage.js";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        {featureDefinitions
          .filter((feature) => feature.status !== "active")
          .map((feature) => (
            <Route
              key={feature.id}
              path={feature.path.slice(1)}
              element={<FeaturePlaceholderPage feature={feature} />}
            />
          ))}
        <Route
          path="rd-intelligence"
          element={<RdIntelligencePage />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
