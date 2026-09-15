// The states a saved draft can be in against the site's main, and what dev
// says about its branch - the ones the demo branches do not reach.

import { describe, expect, it } from "vitest";
import { walkSteps } from "../catalog";
import { LOGIN, SESSION_STARTED, addField, estateWith, flowIn, relabelStep, savedDraft, shownDraft } from "../testing/drafts";
import { healthFrom } from "./model";

const entity = (draft: ReturnType<typeof shownDraft>, id: string) => {
  const found = draft.entities.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} is not in the draft`);
  return found;
};

describe("a draft against a main that moved on", () => {
  const file = savedDraft("demo/login-check", [relabelStep(LOGIN, "s4", "CheckPasswordOrPasskey")]);

  it("is the branch's change while main has what the base had", () => {
    const login = entity(shownDraft(file), LOGIN);
    expect(login.state).toBe("changed");
    expect(login.branch).toEqual(["~ step s4 Check → CheckPasswordOrPasskey"]);
    expect(login.main).toBeUndefined();
  });

  it("is a conflict when main changed the same entity another way, with what main did", () => {
    const main = estateWith(relabelStep(LOGIN, "s4", "CheckWithRisk"));
    const login = entity(shownDraft(file, { main }), LOGIN);
    expect(login.state).toBe("conflict");
    expect(login.branch).toEqual(["~ step s4 Check → CheckPasswordOrPasskey"]);
    expect(login.main).toEqual(["~ step s4 Check → CheckWithRisk"]);
  });

  it("is not a conflict when main made the same change", () => {
    const main = estateWith(relabelStep(LOGIN, "s4", "CheckPasswordOrPasskey"));
    expect(entity(shownDraft(file, { main }), LOGIN).state).toBe("changed");
  });

  it("is not a conflict when main changed something else", () => {
    const main = estateWith(addField(SESSION_STARTED, "ip"));
    expect(entity(shownDraft(file, { main }), LOGIN).state).toBe("changed");
  });

  it("is a conflict when the branch changed what main has since removed", () => {
    const main = estateWith((estate) => {
      estate.flows = estate.flows.filter((flow) => flow.id !== LOGIN);
    });
    const login = entity(shownDraft(file, { main }), LOGIN);
    expect(login.state).toBe("conflict");
    expect(login.main).toEqual([`- flow, ${walkSteps(flowIn(estateWith(), LOGIN).steps).length} steps`]);
  });

  it("is a conflict when two branches' shared entity was added on main differently", () => {
    const added = savedDraft("demo/audit", [addField(SESSION_STARTED, "userAgent")]);
    const main = estateWith(addField(SESSION_STARTED, "userAgent", "UserAgent"));
    const started = entity(shownDraft(added, { main }), SESSION_STARTED);
    expect(started.state).toBe("conflict");
    expect(started.main).toEqual(["+ field userAgent UserAgent"]);
  });
});

describe("what dev says about a draft's branch", () => {
  const status = { path: "portolan-drafts/auth/demo~x.json", project: "auth", branch: "demo/x", tip: "1111111aaaa" };

  it("is fresh when the branch is where the draft was made", () => {
    expect(healthFrom({ ...status, status: "fresh" })).toEqual({ kind: "fresh" });
    expect(healthFrom(undefined)).toEqual({ kind: "fresh" });
  });

  it("is stale with the new tip and how far it moved", () => {
    expect(healthFrom({ ...status, status: "moved", currentTip: "2222222bbbbbbbb", ahead: 3 })).toEqual({ kind: "stale", tip: "2222222", ahead: 3 });
  });

  it("is gone when the branch is not in the repository", () => {
    expect(healthFrom({ ...status, status: "gone" })).toEqual({ kind: "gone" });
  });

  it("is failed with the step it failed at and the message line by line", () => {
    const failure = { message: "base (af83021): go-domain ← examples/auth\nerror: expected ';'", at: "2026-09-15T11:00:00Z", step: "branch: extract go-domain ← examples/auth" };
    expect(healthFrom({ ...status, status: "failed", failure })).toEqual({
      kind: "failed",
      at: failure.at,
      step: failure.step,
      log: ["base (af83021): go-domain ← examples/auth", "error: expected ';'"],
    });
  });
});
