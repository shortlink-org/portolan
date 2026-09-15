// @vitest-environment jsdom
//
// The branches page in the states a saved draft's branch can be in: moved on,
// gone, failed to regenerate - under `portolan dev`, and as a published site.

import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { draftKey } from "../drafts/model";
import type { Draft, DraftHealth } from "../drafts/model";
import { useDrafts } from "../drafts/store";
import { LOGIN, relabelStep, savedDraft, shownDraft } from "../testing/drafts";
import { button, render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { Drafts } from "./Drafts";

const initial = useDrafts.getState();
let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  useDrafts.setState(initial, true);
});

const draft = (branch: string, health: DraftHealth): Draft =>
  shownDraft(savedDraft(branch, [relabelStep(LOGIN, "s4", `Check${branch.length}`)]), { health });

const failure: DraftHealth = {
  kind: "failed",
  at: "2026-09-15T11:00:00Z",
  step: "branch: extract go-domain ← examples/auth",
  log: ["branch (5e61b07): go-domain ← examples/auth", "error: examples/auth/internal/mfa/domain/totp.go:41:18: expected ';'"],
};

async function page(drafts: Draft[], mode: "dev" | "static", outside = 0): Promise<Rendered> {
  // Nothing here asks the dev server: the page's refresh and the branch list
  // would, so they are stood down and the store says what they would have.
  useDrafts.setState({
    mode,
    drafts,
    outside,
    enabled: [draftKey(drafts[0]!)],
    branches: { main: "origin/main", projects: [{ id: "auth", name: "Authentication" }], branches: [] },
    refresh: async () => undefined,
    loadBranches: async () => undefined,
  });
  rendered = await render(
    <MemoryRouter initialEntries={["/drafts"]}>
      <Drafts />
    </MemoryRouter>,
  );
  return rendered;
}

const rowOf = (container: HTMLElement, branch: string) =>
  [...container.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes(branch));

describe("the branches page under portolan dev", () => {
  const drafts = [
    draft("demo/fresh", { kind: "fresh" }),
    draft("demo/moved", { kind: "stale", tip: "c19a7f0", ahead: 2 }),
    draft("demo/gone", { kind: "gone" }),
    draft("demo/failed", failure),
  ];

  it("counts the drafts that need attention", async () => {
    const { text } = await page(drafts, "dev");
    expect(text()).toContain("4 drafts · 1 projects");
    expect(text()).toContain("3 need attention");
  });

  it("says a branch moved past its draft, by how much, and offers to regenerate", async () => {
    const { container, text } = await page(drafts, "dev");
    expect(text()).toContain("the branch moved to c19a7f0, 2 commits this draft does not show");
    const notice = rowOf(container, "demo/moved")!.nextElementSibling!;
    expect(button(notice as HTMLElement, "regenerate")).toBeDefined();
  });

  it("strikes a gone branch through and keeps its draft until it is deleted", async () => {
    const { container, text } = await page(drafts, "dev");
    expect(text()).toContain("the branch is no longer in the repository · the saved draft stays until you delete it");
    expect(rowOf(container, "demo/gone")!.querySelector("a.line-through")?.textContent).toContain("demo/gone");
    expect(button(rowOf(container, "demo/gone") as HTMLElement, "delete")).toBeDefined();
  });

  it("says where regeneration failed, keeps the saved draft, and shows the log on request", async () => {
    const { container, text, click } = await page(drafts, "dev");
    expect(text()).toContain("at “branch: extract go-domain ← examples/auth” · showing the draft saved");
    expect(text()).not.toContain("expected ';'");

    const notice = rowOf(container, "demo/failed")!.nextElementSibling as HTMLElement;
    expect(button(notice, "retry")).toBeDefined();
    await click(button(notice, "show log"));
    expect(text()).toContain("error: examples/auth/internal/mfa/domain/totp.go:41:18: expected ';'");
    expect(button(notice, "hide log")).toBeDefined();
  });

  it("has no notice under a fresh draft", async () => {
    const { container } = await page(drafts, "dev");
    expect(rowOf(container, "demo/fresh")!.nextElementSibling?.textContent).toContain("demo/moved");
  });
});

describe("the branches page on a published site", () => {
  it("lists the saved drafts without dev's notices, generation or deletion", async () => {
    const drafts = [draft("demo/moved", { kind: "stale", tip: "c19a7f0", ahead: 2 }), draft("demo/gone", { kind: "gone" })];
    const { container, text } = await page(drafts, "static");
    expect(text()).toContain("2 drafts · 1 projects");
    expect(text()).toContain("A published site shows the drafts saved in the repository.");
    expect(text()).not.toContain("New draft");
    expect(text()).not.toContain("need attention");
    expect(text()).not.toContain("the branch moved");
    expect(button(container, "delete")).toBeUndefined();
    expect(container.querySelector("a.line-through")).toBeNull();
  });

  it("says how many drafts belong to projects this catalog leaves out", async () => {
    const { text } = await page([draft("demo/fresh", { kind: "fresh" })], "static", 2);
    expect(text()).toContain("2 more of projects this catalog leaves out");
  });
});
