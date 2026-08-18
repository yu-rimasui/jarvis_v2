import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchRdSnapshot, localApi, LocalApiError } from "./api.js";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local R&D API client", () => {
  test("loads the complete read-only dashboard snapshot", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/health") {
        return Promise.resolve(response({ data: { status: "ok" } }));
      }
      return Promise.resolve(response({ data: { items: [] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRdSnapshot()).resolves.toEqual({
      inbox: [],
      insights: [],
      experiments: [],
      drafts: [],
      history: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  test("surfaces bounded API error codes without reflecting unknown content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response(
            {
              error: {
                code: "INVALID_REQUEST",
                message: "入力を確認してください。",
              },
            },
            422,
          ),
        ),
      ),
    );

    await expect(localApi("/api/health")).rejects.toEqual(
      new LocalApiError("INVALID_REQUEST — 入力を確認してください。"),
    );
  });
});
