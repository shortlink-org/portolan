import { describe, expect, it } from "vitest";
import type { Flow, Step } from "../catalog";
import { buildChapters, groupRows } from "./chapters";
import { continuationIndex } from "./continues";
import { buildOutline } from "./outline";
import { journeyFlow, journeyGroups, journeyReach, journeySteps, openEverything } from "./journey";
import type { JourneyGroup, JourneyRow } from "./journey";

function step(id: string, to: string, extra: Partial<Step> = {}): Step {
  return { type: "step", id, from: "client", to, kind: "rpc", status: "declared", ...extra };
}

function flow(slug: string, service: string, steps: Step[], entrypoint?: string): Flow {
  return {
    id: `test.${slug}`,
    slug,
    name: slug.replace(/-/g, " "),
    summary: "",
    owner: "shop",
    participants: [
      { id: "client", kind: "actor", context: "" },
      { id: service, kind: "service", context: "shop" },
    ],
    steps,
    ...(entrypoint ? { entrypoint } : {}),
  };
}

// cart calls oms, oms calls ledger, and ledger calls back into cart - which is
// where the cycle guard earns its place.
const cart = flow("cart-checkout", "shop.cart", [
  step("s1", "shop.cart"),
  step("s2", "shop.oms", { continuesAt: "oms/PlaceOrder" }),
]);
const oms = flow(
  "oms-place-order",
  "shop.oms",
  [step("t1", "shop.oms"), step("t2", "payments.ledger", { continuesAt: "ledger/Authorize" })],
  "oms/PlaceOrder",
);
const ledger = flow(
  "ledger-authorize",
  "payments.ledger",
  [step("u1", "payments.ledger"), step("u2", "shop.cart", { continuesAt: "cart/Checkout" })],
  "ledger/Authorize",
);
const back = flow("cart-checkout-again", "shop.cart", [step("v1", "shop.cart")], "cart/Checkout");
const flows = [cart, oms, ledger, back];

/** The rail's groups for a flow, as the page builds them. */
function groupsOf(source: Flow) {
  const rows = buildOutline(source, { hidden: new Set(), crossOnly: false, path: null, statuses: null });
  return groupRows(rows, buildChapters(source));
}

function journey(opened: Iterable<string>, maxDepth?: number): JourneyGroup[] {
  return journeyGroups(groupsOf(cart), {
    flow: cart,
    flows,
    continuations: continuationIndex(cart, flows),
    opened: new Set(opened),
    ...(maxDepth === undefined ? {} : { maxDepth }),
  });
}

function lines(groups: JourneyGroup[]): string[] {
  return groups.flatMap((group) =>
    group.rows.map((row: JourneyRow) =>
      row.type === "entered"
        ? `${"  ".repeat(row.depth)}[${row.open ? "open" : "closed"} ${row.via.slug}${row.repeats ? " repeats" : ""}${row.deepest ? " deepest" : ""}]`
        : row.type === "step"
          ? `${"  ".repeat(row.depth)}${row.step.id}${row.origin ? ` (${row.origin.slug})` : ""}`
          : `${"  ".repeat(row.depth)}${row.keyword}`,
    ),
  );
}

const DOOR = "s2>oms-place-order";

describe("a path that has not been opened", () => {
  it("is the flow on screen, with a door under the step that continues", () => {
    expect(lines(journey([]))).toEqual(["s1", "s2", "  [closed oms-place-order]"]);
  });

  it("says what is behind the door before it is opened", () => {
    const door = journey([]).flatMap((group) => group.rows).find((row) => row.type === "entered")!;
    expect(door).toMatchObject({ key: DOOR, steps: 2, service: "shop.oms", open: false });
    expect(door.type === "entered" && door.via.kind).toBe("entrypoint");
  });

  it("adds nothing to the reach", () => {
    expect(journeyReach(journey([]))).toEqual({ doors: 1, open: 0, steps: 0, services: 0 });
  });
});

describe("a path the reader opened", () => {
  it("reads the other flow's steps under the step that calls it", () => {
    expect(lines(journey([DOOR]))).toEqual([
      "s1",
      "s2",
      "  [open oms-place-order]",
      "  t1 (oms-place-order)",
      "  t2 (oms-place-order)",
      "    [closed ledger-authorize]",
    ]);
  });

  it("says whose every followed row is, and how deep", () => {
    const rows = journey([DOOR]).flatMap((group) => group.rows);
    const followed = rows.filter((row) => row.type === "step" && row.origin);
    expect(followed.map((row) => row.type === "step" && row.origin?.depth)).toEqual([1, 1]);
    expect(followed.map((row) => row.type === "step" && row.origin?.service)).toEqual(["shop.oms", "shop.oms"]);
    // Two flows both call their first step `t1`; the keys keep them apart.
    expect(rows.map((row) => row.key)).toEqual([
      "s1",
      "s2",
      DOOR,
      `${DOOR}/t1`,
      `${DOOR}/t2`,
      `${DOOR}/t2>ledger-authorize`,
    ]);
  });

  it("counts what the opened path adds", () => {
    expect(journeyReach(journey([DOOR]))).toEqual({ doors: 2, open: 1, steps: 2, services: 1 });
  });

  it("walks as one rail: every step of the path, in order", () => {
    expect(journeySteps(journey([DOOR])).map((row) => row.step.id)).toEqual(["s1", "s2", "t1", "t2"]);
  });
});

describe("the guards", () => {
  it("does not follow a flow already on the path, and says why", () => {
    const deep = [DOOR, `${DOOR}/t2>ledger-authorize`, `${DOOR}/t2>ledger-authorize/u2>cart-checkout-again`];
    const rows = journey(deep).flatMap((group) => group.rows);
    const again = rows.find((row) => row.type === "entered" && row.via.slug === "cart-checkout-again");
    // `cart-checkout-again` is a flow of its own, so it opens; the cycle is
    // the one a flow makes back into itself.
    expect(again).toMatchObject({ open: true });
    // The flow the reader is on never opens again inside its own path.
    const twice = rows.find((row) => row.type === "entered" && row.via.slug === "cart-checkout" );
    expect(twice).toBeUndefined();
  });

  it("stops a flow that comes round to one already entered", () => {
    const loop = flow("loop-a", "shop.a", [step("a1", "shop.b", { continuesAt: "b/Enter" })]);
    const other = flow("loop-b", "shop.b", [step("b1", "shop.a", { continuesAt: "a/Enter" })], "b/Enter");
    // `loop-a` is what the reader is on, and `loop-b` calls straight back to it.
    const withEntry: Flow = { ...loop, entrypoint: "a/Enter" };
    const two = [withEntry, other];
    const groups = journeyGroups(groupRows(buildOutline(withEntry, { hidden: new Set(), crossOnly: false, path: null, statuses: null }), buildChapters(withEntry)), {
      flow: withEntry,
      flows: two,
      continuations: continuationIndex(withEntry, two),
      opened: new Set(["a1>loop-b", "a1>loop-b/b1>loop-a"]),
    });
    const rows = groups.flatMap((group) => group.rows);
    const back = rows.find((row) => row.type === "entered" && row.via.slug === "loop-a");
    expect(back).toMatchObject({ repeats: true, open: false });
    expect(rows.filter((row) => row.type === "step").map((row) => row.key)).toEqual(["a1", "a1>loop-b/b1"]);
  });

  it("stops at the depth it says it stops at", () => {
    const rows = journey([DOOR, `${DOOR}/t2>ledger-authorize`], 1).flatMap((group) => group.rows);
    const deeper = rows.find((row) => row.type === "entered" && row.via.slug === "ledger-authorize");
    expect(deeper).toMatchObject({ deepest: true, open: false });
  });
});

describe("opening everything", () => {
  it("opens every door the guards allow, and no more", () => {
    const opened = openEverything(groupsOf(cart), { flow: cart, flows, continuations: continuationIndex(cart, flows) });
    expect([...opened].sort()).toEqual(
      [DOOR, `${DOOR}/t2>ledger-authorize`, `${DOOR}/t2>ledger-authorize/u2>cart-checkout-again`].sort(),
    );
    const reach = journeyReach(journey(opened));
    expect(reach).toMatchObject({ open: 3, steps: 5, services: 3 });
  });

  it("stops where the depth does", () => {
    expect(openEverything(groupsOf(cart), { flow: cart, flows, continuations: continuationIndex(cart, flows), maxDepth: 1 })).toEqual(new Set([DOOR]));
  });
});

describe("the path as one flow", () => {
  const composed = (opened: Iterable<string>) =>
    journeyFlow({ flow: cart, flows, continuations: continuationIndex(cart, flows), opened: new Set(opened) });

  it("is the flow itself when nothing is opened", () => {
    expect(composed([]).steps.map((node) => node.id)).toEqual(["s1", "s2"]);
    expect(composed([]).participants.map((p) => p.id)).toEqual(["client", "shop.cart"]);
  });

  it("splices the followed flow in after the step that calls it", () => {
    const flow = composed([DOOR, `${DOOR}/t2>ledger-authorize`]);
    expect(flow.steps.map((node) => node.id)).toEqual([
      "s1",
      "s2",
      `${DOOR}/t1`,
      `${DOOR}/t2`,
      `${DOOR}/t2>ledger-authorize/u1`,
      `${DOOR}/t2>ledger-authorize/u2`,
    ]);
  });

  it("brings the lanes the followed flows need", () => {
    expect(composed([DOOR]).participants.map((p) => p.id)).toEqual(["client", "shop.cart", "shop.oms"]);
  });

  it("keeps the flow's own name, slug and owner: it is a reading of that flow", () => {
    const flow = composed([DOOR]);
    expect([flow.slug, flow.name, flow.owner]).toEqual([cart.slug, cart.name, cart.owner]);
  });
});
