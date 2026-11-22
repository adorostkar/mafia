// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { Rulebook } from "./Rulebook";
import { translations } from "./i18n";

afterEach(cleanup);

it("flips illustrated library cards without exposing the inactive text and preserves the side on language changes", async () => {
  const t = translations("en");
  const props = { section: "characters" as const, onSectionChange: vi.fn() };
  const { rerender, container } = render(<Rulebook t={t} {...props} />);
  expect(screen.getAllByRole("button", { name: /^Read role:/ })).toHaveLength(
    13,
  );
  expect(
    screen.queryByText(t.roleDescription.godfather),
  ).not.toBeInTheDocument();
  const flip = screen.getByRole("button", { name: "Read role: Godfather" });
  flip.focus();
  fireEvent.click(flip);
  expect(flip).toHaveFocus();
  expect(flip).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(t.roleDescription.godfather)).toBeVisible();
  rerender(<Rulebook t={translations("fi")} {...props} />);
  expect(
    screen.getByText(translations("fi").roleDescription.godfather),
  ).toBeVisible();
  fireEvent.click(flip);
  expect(
    screen.queryByText(translations("fi").roleDescription.godfather),
  ).not.toBeInTheDocument();
  expect(
    (
      await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
