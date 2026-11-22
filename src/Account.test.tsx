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
import { Account, RecoveryDialog } from "./Account";
import { translations } from "./i18n";
import { request } from "./client";

vi.mock("./client", () => ({
  request: vi.fn(),
  errorCode: vi.fn(() => "authentication"),
  download: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const guest = { id: "guest", username: null, isGuest: true };
const t = translations("en");

it("registers the guest profile and hands its one-time recovery code to the save dialog", async () => {
  const identity = { ...guest, username: "aino", isGuest: false };
  vi.mocked(request).mockResolvedValueOnce({
    identity,
    recoveryCode: "test-only-recovery-code",
  });
  const onIdentity = vi.fn();
  const onRecovery = vi.fn();
  const { container } = render(
    <Account
      identity={guest}
      t={t}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "Aino" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "long example passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "long example passphrase" },
  });
  fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
  await waitFor(() => expect(onIdentity).toHaveBeenCalledWith(identity));
  expect(request).toHaveBeenCalledWith(
    "/auth/register",
    expect.objectContaining({
      username: "aino",
      password: "long example passphrase",
      confirmPassword: "long example passphrase",
    }),
  );
  expect(onRecovery).toHaveBeenCalledWith({
    code: "test-only-recovery-code",
    username: "aino",
    recovered: false,
  });
  expect(
    (
      await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it("keeps recovery secrets hidden from the screen and accessibility tree until revealed", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const onSaved = vi.fn();
  render(
    <RecoveryDialog
      recovery={{
        username: "aino",
        code: "test-only-recovery-code",
        recovered: true,
      }}
      t={t}
      onSaved={onSaved}
    />,
  );
  expect(screen.queryByText("test-only-recovery-code")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.text.revealRecovery }));
  expect(screen.getByText("test-only-recovery-code")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: t.text.savedRecovery }));
  expect(onSaved).toHaveBeenCalledOnce();
});

it("reports authentication failures without losing the form or claiming success", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("authentication"));
  const onIdentity = vi.fn();
  render(
    <Account
      identity={guest}
      t={translations("fi")}
      onIdentity={onIdentity}
      onRecovery={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Kirjaudu sisään", pressed: false }),
  );
  fireEvent.change(screen.getByLabelText("Käyttäjänimi"), {
    target: { value: "aino" },
  });
  fireEvent.change(screen.getByLabelText("Salasana"), {
    target: { value: "wrong example password" },
  });
  fireEvent.submit(screen.getByLabelText("Käyttäjänimi").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    translations("fi").error.authentication,
  );
  expect(onIdentity).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Käyttäjänimi")).toHaveValue("aino");
});
