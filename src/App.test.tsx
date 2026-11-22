// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import App from "./App";
import { request } from "./client";
import { translations } from "./i18n";

vi.mock("./client", () => ({
  initialize: vi.fn(async () => ({
    id: "profile",
    isGuest: true,
    username: null,
    emailEnabled: false,
    email: null,
    pendingEmail: null,
  })),
  request: vi.fn(async () => []),
  replaceIdentity: vi.fn(),
  errorCode: vi.fn(() => "network"),
}));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  history.replaceState(null, "", "/");
  vi.clearAllMocks();
});

it("introduces factions on the homepage and opens the library for character details", async () => {
  const t = translations("en");
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Your name")).toBeEnabled());
  const home = within(screen.getByRole("main"));
  for (const name of ["Mafia", "Citizen", "Third Party"]) {
    expect(home.getByRole("heading", { name, level: 3 })).toBeVisible();
  }
  expect(
    home.queryByText("Godfather", { exact: true }),
  ).not.toBeInTheDocument();
  expect(home.queryByText(t.roleDescription.godfather)).not.toBeInTheDocument();
  fireEvent.click(home.getByRole("button", { name: "Character library" }));
  expect(screen.getAllByRole("button", { name: /^Read role:/ })).toHaveLength(
    13,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read role: Godfather" }));
  expect(screen.getByText(t.roleDescription.godfather)).toBeVisible();
});

it("removes reset tokens from the address bar and waits for a new password before using them", async () => {
  const token = "s".repeat(43);
  history.replaceState(null, "", `/?view=reset#token=${token}`);
  const { container } = render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Choose a new password." }),
  ).toBeVisible();
  expect(location.hash).toBe("");
  expect(request).not.toHaveBeenCalledWith(
    "/auth/reset-password",
    expect.anything(),
  );
  vi.mocked(request).mockResolvedValueOnce({
    identity: {
      id: "profile",
      isGuest: true,
      username: null,
      emailEnabled: true,
      email: null,
      pendingEmail: null,
    },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new private passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "new private passphrase" },
  });
  fireEvent.submit(screen.getByLabelText("New password").closest("form")!);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/auth/reset-password", {
      token,
      password: "new private passphrase",
      confirmPassword: "new private passphrase",
    }),
  );
  expect(await screen.findByText(/Your password has been reset/)).toBeVisible();
  expect(container.textContent).not.toContain(token);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByLabelText("Username or email")).toBeVisible();
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

it("switches Persian layout and learning content without losing a player's form input", async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Your name")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "آرمان" },
  });
  fireEvent.change(screen.getByLabelText("Join code"), {
    target: { value: "ABC234" },
  });
  fireEvent.change(screen.getByLabelText("Language"), {
    target: { value: "fa" },
  });
  expect(document.documentElement.lang).toBe("fa");
  expect(document.documentElement.dir).toBe("rtl");
  expect(screen.getByLabelText("نام شما")).toHaveValue("آرمان");
  expect(screen.getByLabelText("کد ورود")).toHaveValue("ABC234");
  expect(screen.getByRole("button", { name: /ساخت بازی/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "روش بازی" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "کتابخانهٔ شخصیت‌ها" }),
  );
  const card = screen.getByRole("article", { name: "پدرخوانده" });
  expect(card).toHaveTextContent("پدرخوانده");
  fireEvent.change(screen.getByLabelText("زبان"), {
    target: { value: "en" },
  });
  expect(document.documentElement.dir).toBe("ltr");
  expect(screen.getByRole("article", { name: "Godfather" })).toBeVisible();
});

it("accepts join-code digits from Persian and Arabic keyboards", async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Join code")).toBeEnabled());
  const code = screen.getByLabelText("Join code");
  fireEvent.change(code, { target: { value: "ABC۲۳۴" } });
  expect(code).toHaveValue("ABC234");
  expect(code).toBeValid();
  fireEvent.change(code, { target: { value: "ABC٢٣٤" } });
  expect(code).toHaveValue("ABC234");
  expect(code).toBeValid();
});
