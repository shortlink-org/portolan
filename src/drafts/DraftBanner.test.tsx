// @vitest-environment jsdom
//
// The version banner on an entity's page, in the states the demo branches do
// not reach: a conflict with main, and two branches changing one entity.

import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { LOGIN, SESSION_STARTED, addField, estateWith, relabelStep, savedDraft, shownDraft } from "../testing/drafts";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { DraftBanner } from "./DraftBanner";
import { draftKey } from "./model";
import type { Draft } from "./model";
import { useDrafts } from "./store";

const initial = useDrafts.getState();
let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  useDrafts.setState(initial, true);
});

async function show(drafts: Draft[], id: string, url: string, enabled = drafts.map(draftKey)): Promise<Rendered> {
  useDrafts.setState({ drafts, enabled });
  rendered = await render(
    <MemoryRouter initialEntries={[url]}>
      <DraftBanner id={id} />
    </MemoryRouter>,
  );
  return rendered;
}

const loginCheck = (main = estateWith()) =>
  shownDraft(savedDraft("demo/login-check", [relabelStep(LOGIN, "s4", "CheckPasswordOrPasskey")]), { main });

describe("DraftBanner", () => {
  it("shows both sides of a conflict when the conflicting branch is picked", async () => {
    const draft = loginCheck(estateWith(relabelStep(LOGIN, "s4", "CheckWithRisk")));
    const page = (await show([draft], LOGIN, "/flows/auth-login?v=demo/login-check")).text();

    expect(page).toContain("Conflict");
    expect(page).toContain("in demo/login-check");
    expect(page).toContain("~ step s4 Check → CheckPasswordOrPasskey");
    expect(page).toContain(`main changed it too, since ${draft.base}`);
    expect(page).toContain("~ step s4 Check → CheckWithRisk");
  });

  it("offers the versions but shows no lines until one is picked", async () => {
    const { container, text, click } = await show([loginCheck()], LOGIN, "/flows/auth-login");
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["main", "demo/login-check"]);
    expect(text()).not.toContain("~ step s4");

    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "demo/login-check"));
    expect(text()).toContain("~ step s4 Check → CheckPasswordOrPasskey");
  });

  it("says two branches change the same entity, and lists what the other one did", async () => {
    const passkeys = shownDraft(savedDraft("demo/passkeys", [addField(SESSION_STARTED, "method")]));
    const audit = shownDraft(savedDraft("demo/audit", [addField(SESSION_STARTED, "userAgent")]));
    const { container, text } = await show([passkeys, audit], SESSION_STARTED, "/c/auth/auth/session/session-started?v=demo/passkeys");

    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["main", "demo/passkeys", "demo/audit"]);
    const page = text();
    expect(page).toContain("2 branches change this event: demo/passkeys, demo/audit");
    expect(page).toContain("+ field method string");
    expect(page).toContain("also in demo/audit");
    expect(page).toContain("+ field userAgent string");
    expect(page).toContain("compare demo/passkeys");
    expect(page).toContain("compare demo/audit");
  });

  it("shows nothing for an entity no draft touches at all", async () => {
    expect((await show([loginCheck()], SESSION_STARTED, "/c/auth/auth/session/session-started")).text()).toBe("");
  });

  it("is one quiet line, not a banner, for a draft that touches this and is not ticked", async () => {
    const { container, text } = await show([loginCheck()], LOGIN, "/flows/auth-login", []);
    const page = text();
    expect(page).toContain("1 draft touches this");
    expect(page).toContain("demo/login-check");
    // No version switch and no state chips: the page is still main's.
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["show"]);
    expect(page).not.toContain("version");
  });
});
