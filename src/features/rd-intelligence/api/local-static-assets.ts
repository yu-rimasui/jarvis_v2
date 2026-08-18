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

const UI_BUILD_DIRECTORY = resolve("dist", "ui");

// Only routes declared by the React application receive its index document.
// Arbitrary repository and build paths remain unreadable from the browser.
const UI_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/index.html",
  "/rd-intelligence",
  "/chat",
  "/memory",
  "/tasks",
  "/models",
]);

const STATIC_ASSETS: ReadonlyMap<string, StaticAssetDescriptor> = new Map([
  [
    "/assets/app.js",
    {
      contentType: "text/javascript; charset=utf-8",
      fileName: "assets/app.js",
    },
  ],
  [
    "/assets/app.css",
    {
      contentType: "text/css; charset=utf-8",
      fileName: "assets/app.css",
    },
  ],
]);

export async function readStaticAsset(
  path: string,
): Promise<StaticAsset | undefined> {
  const descriptor = UI_ROUTES.has(path)
    ? {
        contentType: "text/html; charset=utf-8",
        fileName: "index.html",
      }
    : STATIC_ASSETS.get(path);
  if (descriptor === undefined) return undefined;

  return {
    body: await readFile(resolve(UI_BUILD_DIRECTORY, descriptor.fileName)),
    contentType: descriptor.contentType,
  };
}
