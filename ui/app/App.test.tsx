import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { App } from "./App.js";

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
    expect(screen.getByText("UI MIGRATION IN PROGRESS")).toBeInTheDocument();
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
