// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import App from "./App";

vi.mock("./client", () => ({
  initialize: vi.fn(async () => ({
    id: "profile",
    isGuest: true,
    username: null,
  })),
  request: vi.fn(async () => []),
  replaceIdentity: vi.fn(),
  errorCode: vi.fn(() => "network"),
}));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  history.replaceState(null, "", "/");
});

it("switches the whole home interface instantly and preserves form input", async () => {
  const { container } = render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Create a game/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Aino" },
  });
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "fi" },
  });
  expect(screen.getByLabelText("Nimesi")).toHaveValue("Aino");
  expect(screen.getByRole("button", { name: /Luo peli/ })).toBeVisible();
  expect(document.documentElement.lang).toBe("fi");
  fireEvent.click(screen.getByRole("button", { name: "Suuri kontrasti" }));
  expect(document.documentElement.dataset.contrast).toBe("true");
  expect(
    (
      await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
