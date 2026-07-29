import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface StaticAssetDescriptor {
  readonly contentType: string;
  readonly fileName: string;
}

export interface StaticAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

const DASHBOARD_MOCK_DIRECTORY = resolve("mocks", "dashboard");

// The dashboard is a local presentation mock. It is served only through this
// allowlist so a browser cannot read arbitrary repository files.
const STATIC_ASSETS: ReadonlyMap<string, StaticAssetDescriptor> = new Map([
  [
    "/",
    {
      contentType: "text/html; charset=utf-8",
      fileName: "index.html",
    },
  ],
  [
    "/index.html",
    {
      contentType: "text/html; charset=utf-8",
      fileName: "index.html",
    },
  ],
  [
    "/app.js",
    {
      contentType: "text/javascript; charset=utf-8",
      fileName: "app.js",
    },
  ],
  [
    "/rd-intelligence.js",
    {
      contentType: "text/javascript; charset=utf-8",
      fileName: "rd-intelligence.js",
    },
  ],
  [
    "/styles.css",
    {
      contentType: "text/css; charset=utf-8",
      fileName: "styles.css",
    },
  ],
  [
    "/dashboard.css",
    {
      contentType: "text/css; charset=utf-8",
      fileName: "dashboard.css",
    },
  ],
  [
    "/motion.css",
    {
      contentType: "text/css; charset=utf-8",
      fileName: "motion.css",
    },
  ],
  [
    "/rd-intelligence.css",
    {
      contentType: "text/css; charset=utf-8",
      fileName: "rd-intelligence.css",
    },
  ],
]);

export async function readStaticAsset(
  path: string,
): Promise<StaticAsset | undefined> {
  const descriptor = STATIC_ASSETS.get(path);
  if (descriptor === undefined) return undefined;

  return {
    body: await readFile(resolve(DASHBOARD_MOCK_DIRECTORY, descriptor.fileName)),
    contentType: descriptor.contentType,
  };
}
