// @vitest-environment jsdom
//
// The compare page of one branch, in the states the demo branches do not
// reach: an entity in conflict with main, and one another branch changes too.

import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { draftKey } from "../drafts/model";
import type { Draft } from "../drafts/model";
import { useDrafts } from "../drafts/store";
import { LOGIN, SESSION_STARTED, addField, estateWith, relabelStep, savedDraft, shownDraft } from "../testing/drafts";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { DraftCompare } from "./DraftCompare";

const initial = useDrafts.getState();
let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  useDrafts.setState(initial, true);
});

async function compare(drafts: Draft[], branch: string): Promise<Rendered> {
  useDrafts.setState({ mode: "static", drafts, enabled: drafts.map(draftKey) });
  rendered = await render(
    <MemoryRouter initialEntries={[`/drafts/auth/${encodeURIComponent(branch)}`]}>
      <Routes>
        <Route path="/drafts/:project/:branch" element={<DraftCompare />} />
      </Routes>
    </MemoryRouter>,
  );
  return rendered;
}

// Main moved the login flow's s4 one way; this branch moved it another, and
// added a field to SessionStarted, which the audit branch adds a field to too.
const main = estateWith(relabelStep(LOGIN, "s4", "CheckWithRisk"));
const passkeys = shownDraft(
  savedDraft("demo/passkeys", [relabelStep(LOGIN, "s4", "CheckPasswordOrPasskey"), addField(SESSION_STARTED, "method")]),
  { main },
);
const audit = shownDraft(savedDraft("demo/audit", [addField(SESSION_STARTED, "userAgent")]), { main });

const counter = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button[aria-pressed]")].find((button) => button.textContent?.includes(label))?.querySelector(".tnum")?.textContent;

describe("DraftCompare", () => {
  it("counts the branch's changes by how they read against main", async () => {
    const { container } = await compare([passkeys, audit], "demo/passkeys");
    expect(counter(container, "Conflict")).toBe("1");
    expect(counter(container, "Changed")).toBe("1");
    expect(counter(container, "Added")).toBe("0");
    expect(counter(container, "Removed")).toBe("0");
  });

  it("shows a conflict as the branch's side and main's side", async () => {
    const { container } = await compare([passkeys, audit], "demo/passkeys");
    const row = container.querySelector(`[id="draft-${LOGIN}"]`) as HTMLElement;
    const sides = [...row.querySelectorAll(".grid > div")].map((side) => side.textContent?.replace(/\s+/g, " ").trim());
    expect(sides).toEqual(["in demo/passkeys~ step s4 Check → CheckPasswordOrPasskey", "on main since the base~ step s4 Check → CheckWithRisk"]);
  });

  it("marks an entity another saved branch changes too, linked to that branch", async () => {
    const { container } = await compare([passkeys, audit], "demo/passkeys");
    const row = container.querySelector(`[id="draft-${SESSION_STARTED}"]`) as HTMLElement;
    const also = [...row.querySelectorAll("a")].find((link) => link.textContent === "also in demo/audit");
    expect(also?.getAttribute("href")).toBe("/drafts/auth/demo%2Faudit");
    expect(container.querySelector(`[id="draft-${LOGIN}"]`)!.textContent).not.toContain("also in");
  });

  it("narrows to the conflicts when the other counters are turned off", async () => {
    const { container, text, click } = await compare([passkeys, audit], "demo/passkeys");
    for (const label of ["Added", "Changed", "Removed"]) await click([...container.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent?.includes(label)));
    expect(text()).toContain("1 of 2 entities");
    expect(container.querySelector(`[id="draft-${SESSION_STARTED}"]`)).toBeNull();
    expect(container.querySelector(`[id="draft-${LOGIN}"]`)).not.toBeNull();
  });
});
