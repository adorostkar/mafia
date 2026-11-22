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
const guest = {
  id: "guest",
  username: null,
  isGuest: true,
  emailEnabled: false,
  email: null,
  pendingEmail: null,
};
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
  expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
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

it("requires email in email mode and verifies it without forcing a recovery-code download", async () => {
  const identity = { ...guest, emailEnabled: true };
  const pending = { ...identity, pendingEmail: "aino@example.com" };
  const verified = {
    ...identity,
    isGuest: false,
    username: "aino",
    email: "aino@example.com",
    pendingEmail: null,
  };
  vi.mocked(request).mockResolvedValueOnce({ identity: pending });
  const onIdentity = vi.fn();
  const onRecovery = vi.fn();
  const { rerender, container } = render(
    <Account
      identity={identity}
      t={t}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  expect(screen.getByLabelText("Email address")).toBeRequired();
  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "aino" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "aino@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "long example passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "long example passphrase" },
  });
  fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
  await waitFor(() => expect(onIdentity).toHaveBeenCalledWith(pending));
  expect(request).toHaveBeenCalledWith(
    "/auth/register",
    expect.objectContaining({
      email: "aino@example.com",
      language: "en",
    }),
  );
  rerender(
    <Account
      identity={pending}
      t={t}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Check your email." }),
  ).toBeVisible();
  vi.mocked(request).mockResolvedValueOnce({ identity: verified });
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "004012" },
  });
  fireEvent.submit(screen.getByLabelText("Verification code").closest("form")!);
  await waitFor(() => expect(onIdentity).toHaveBeenCalledWith(verified));
  expect(request).toHaveBeenCalledWith("/auth/verify-email", {
    code: "004012",
  });
  expect(onRecovery).not.toHaveBeenCalled();
  expect(
    (
      await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it("offers email recovery first and keeps backup-code recovery available", async () => {
  vi.mocked(request).mockResolvedValueOnce({ ok: true });
  const onIdentity = vi.fn();
  const onRecovery = vi.fn();
  const { rerender } = render(
    <Account
      identity={{ ...guest, emailEnabled: true }}
      t={t}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Recover account", pressed: false }),
  );
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "aino@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/auth/request-reset",
      expect.objectContaining({
        email: "aino@example.com",
        language: "en",
      }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "If an account uses this verified email",
  );
  expect(onIdentity).not.toHaveBeenCalled();
  rerender(
    <Account
      identity={{ ...guest, emailEnabled: true }}
      t={translations("fa")}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    translations("fa").text.resetRequested,
  );
  rerender(
    <Account
      identity={{ ...guest, emailEnabled: true }}
      t={t}
      onIdentity={onIdentity}
      onRecovery={onRecovery}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
  expect(screen.getByLabelText("Recovery code")).toBeRequired();
  expect(screen.getByLabelText("New password")).toBeRequired();
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
