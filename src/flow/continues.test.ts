import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { walkSteps } from "../catalog";
import type { Flow, Step } from "../catalog";
import { continuationIndex, continuationsOf, openingRef } from "./continues";

/** A step carrying `ref`; the participants are not what any of this is about. */
function step(id: string, ref?: string): Step {
  return {
    type: "step",
    id,
    from: "a",
    to: "b",
    kind: ref ? "event" : "call",
    ...(ref ? { ref } : {}),
    status: "declared",
  };
}

function makeFlow(slug: string, steps: Step[]): Flow {
  return {
    id: `test.${slug}`,
    slug,
    name: slug.replace(/-/g, " "),
    summary: "",
    owner: "shop",
    participants: [],
    steps,
  };
}

// The fixture estate has no flow that opens on an event — every one of them
// starts with an inbound call — so the seam this module is about is built by
// hand here. That is the honest way round: the rule is what is under test, and
// a catalog that happens not to exercise it must not silently skip it.
const emits = makeFlow("emits", [step("s1"), step("s2", "shop.oms.Order.Placed")]);
const opens = makeFlow("opens", [
  step("t1", "shop.oms.Order.Placed"),
  step("t2", "shop.oms.Order.Priced"),
]);
const mentions = makeFlow("mentions", [
  step("u1"),
  step("u2", "shop.oms.Order.Placed"),
]);
const flows = [emits, opens, mentions];

describe("openingRef", () => {
  it("is the ref of the flow's first step, in walk order", () => {
    expect(openingRef(opens)).toBe("shop.oms.Order.Placed");
    expect(openingRef(emits)).toBeUndefined();
    for (const f of catalog.flows) {
      expect(openingRef(f)).toBe(walkSteps(f.steps)[0]?.ref);
    }
  });
});

describe("continuationsOf", () => {
  it("finds the flow a step's event opens", () => {
    const hits = continuationsOf(step("s2", "shop.oms.Order.Placed"), emits, flows);
    expect(hits.map((h) => h.slug)).toEqual(["opens"]);
    expect(hits[0]).toMatchObject({ kind: "event", confidence: "medium" });
  });

  it("ignores an event another flow merely mentions in its middle", () => {
    // `mentions` carries the same ref, but not first, so it is another reader
    // of the event rather than the continuation of this one.
    const hits = continuationsOf(step("s2", "shop.oms.Order.Placed"), emits, flows);
    expect(hits.map((h) => h.slug)).not.toContain("mentions");
  });

  it("never points a flow at itself", () => {
    const hits = continuationsOf(step("t1", "shop.oms.Order.Placed"), opens, flows);
    expect(hits).toEqual([]);
  });

  it("says nothing for a step that carries no ref", () => {
    expect(continuationsOf(step("s1"), emits, flows)).toEqual([]);
  });

  it("does not infer continuations from a shared rpc ref", () => {
    const request = { ...step("rpc", "shop.v1.Cart/Get"), kind: "rpc" as const };
    const receiver = makeFlow("receiver", [{ ...request, id: "open" }]);
    expect(continuationsOf(request, emits, [emits, receiver])).toEqual([]);
  });

  it("prefers a proven source entrypoint", () => {
    const sending = { ...step("send"), continuesAt: "billing.issue" };
    const receiver = { ...makeFlow("worker", [step("open")]), entrypoint: "billing.issue" };
    expect(continuationsOf(sending, emits, [emits, receiver])).toEqual([
      expect.objectContaining({ kind: "entrypoint", confidence: "high" }),
    ]);
  });
});

describe("continuationIndex", () => {
  it("agrees with the per-step answer", () => {
    const index = continuationIndex(emits, flows);
    for (const s of walkSteps(emits.steps)) {
      expect(index.get(s.id) ?? []).toEqual(continuationsOf(s, emits, flows));
    }
  });

  it("holds an entry only for steps that actually continue somewhere", () => {
    const index = continuationIndex(emits, flows);
    expect([...index.keys()]).toEqual(["s2"]);
    for (const [, hits] of index) expect(hits.length).toBeGreaterThan(0);
  });

  it("agrees with the per-step answer across the real catalog too", () => {
    for (const f of catalog.flows) {
      const index = continuationIndex(f, catalog.flows);
      for (const s of walkSteps(f.steps)) {
        expect(index.get(s.id) ?? []).toEqual(continuationsOf(s, f, catalog.flows));
      }
    }
  });
});
