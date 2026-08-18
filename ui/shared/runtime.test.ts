import { describe, expect, test } from "vitest";
import { routerBasename } from "./runtime.js";

describe("routerBasename", () => {
  test("keeps the local root route", () => {
    expect(routerBasename("/")).toBe("/");
  });

  test("normalizes a GitHub Pages repository base", () => {
    expect(routerBasename("/jarvis_v2/")).toBe("/jarvis_v2");
  });
});
