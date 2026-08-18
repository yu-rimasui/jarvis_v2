import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const uiRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: uiRoot,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/app[extname]",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./test-setup.ts", import.meta.url))],
    include: ["**/*.test.{ts,tsx}"],
    css: true,
    clearMocks: true,
  },
});
