export const isStaticPreview =
  import.meta.env.VITE_STATIC_PREVIEW === "true";

export function routerBasename(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/$/u, "");
  return withoutTrailingSlash || "/";
}
