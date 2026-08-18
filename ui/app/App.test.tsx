import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.js";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/health") return Promise.resolve(response({ status: "ok" }));
      return Promise.resolve(response({ items: [] }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Jarvis app routes", () => {
  test("renders the dashboard and navigates through a feature card", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /今日は何を進めますか/u }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /R&D Intelligence/u })).toHaveLength(
      2,
    );
    await user.click(
      screen.getAllByRole("link", { name: /R&D Intelligence/u })[1]!,
    );

    expect(
      screen.getByRole("heading", { name: "R&D Intelligence" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/保存済みデータを更新しました/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /JSONを取り込む/u }),
    ).toBeInTheDocument();
  });

  test("shows a clear not-found page for unknown routes", () => {
    render(
      <MemoryRouter initialEntries={["/unknown"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeInTheDocument();
  });
});
