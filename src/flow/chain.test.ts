import { beforeEach, describe, expect, it } from "vitest";

import type {
  BoundedContext,
  Catalog,
  Event,
  Flow,
  FlowNode,
  Participant,
  Service,
} from "../catalog";
import { catalog as real } from "../data";
import { eventChain } from "./chain";
import type { ChainNode } from "./chain";

// ---------------------------------------------------------------------------
// An estate of three services passing events along: oms publishes OrderPlaced,
// ledger hears it and publishes PaymentAuthorized, oms hears that and
// publishes OrderConfirmed, delivery hears that.
// ---------------------------------------------------------------------------

const PLACED = "shop.oms.order.OrderPlaced";
const AUTHORIZED = "payments.ledger.payment.PaymentAuthorized";
const CONFIRMED = "shop.oms.order.OrderConfirmed";

function event(id: string, consumers: Event["consumers"]): Event {
  const name = id.split(".").pop()!;
  return {
    id,
    slug: name.toLowerCase(),
    name,
    versions: [{ version: "v1", doc: "", source: "x", fields: [] }],
    consumers,
  };
}

function service(contextId: string, slug: string, aggregate: string, events: Event[]): Service {
  const id = `${contextId}.${slug}`;
  return {
    id,
    slug,
    name: slug,
    repo: "",
    path: "",
    readme: "",
    provides: [],
    consumes: [],
    aggregates: [
      {
        id: `${id}.${aggregate}`,
        slug: aggregate,
        name: aggregate,
        readme: "",
        root: aggregate,
        entities: [],
        valueObjects: [],
        operations: [],
        events,
      },
    ],
  };
}

function context(id: string, services: Service[]): BoundedContext {
  return { id, slug: id, name: id, summary: "", services };
}

const LANES: Participant[] = [
  { id: "client", kind: "actor", context: null },
  { id: "shop.oms", kind: "service", context: "shop" },
  { id: "payments.ledger", kind: "service", context: "payments" },
  { id: "delivery.core", kind: "service", context: "delivery" },
  { id: "bus", kind: "broker", context: null },
  { id: "warehouse", kind: "external", context: null },
];

let n = 0;
beforeEach(() => {
  n = 0;
});
function step(
  from: string,
  to: string,
  kind: "rpc" | "event" | "call",
  extra: Partial<Extract<FlowNode, { type: "step" }>> = {},
): FlowNode {
  n += 1;
  return { type: "step", id: `s${n}`, from, to, kind, status: "declared", ...extra };
}

function flow(slug: string, steps: FlowNode[]): Flow {
  return { id: `flow.${slug}`, slug, name: slug, summary: "", owner: "shop", participants: LANES, steps };
}

function estate(
  flows: Flow[],
  consumers: Partial<Record<string, Event["consumers"]>> = {},
): Catalog {
  const of = (id: string, fallback: Event["consumers"]) => consumers[id] ?? fallback;
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    commit: "0000000",
    contexts: [
      context("shop", [
        service("shop", "oms", "order", [
          event(PLACED, of(PLACED, [{ service: "payments.ledger", status: "declared" }])),
          event(CONFIRMED, of(CONFIRMED, [{ service: "delivery.core", status: "declared" }])),
        ]),
      ]),
      context("payments", [
        service("payments", "ledger", "payment", [
          event(AUTHORIZED, of(AUTHORIZED, [{ service: "shop.oms", status: "verified" }])),
        ]),
      ]),
      context("delivery", [service("delivery", "core", "shipment", [])]),
    ],
    defs: {},
    flows,
    adrs: [],
  };
}

/** The tree as indented lines, which is what a reader would compare. */
function outline(nodes: ChainNode[]): string[] {
  const out: string[] = [];
  const walk = (list: ChainNode[]) => {
    for (const node of list) {
      const label =
        node.kind === "consumer"
          ? node.service
          : node.kind === "receipt"
            ? `in ${node.flow} · step ${node.number}`
            : `${node.name} · step ${node.number}`;
      const cut = node.cut ? ` [${node.cut.reason} ${node.cut.hidden}]` : "";
      out.push(`${"  ".repeat(node.depth)}${label} (${node.status})${cut}`);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

const SAGA = flow("saga", [
  step("client", "shop.oms", "rpc"),
  step("shop.oms", "bus", "event", { ref: PLACED }),
  step("bus", "payments.ledger", "event", { ref: PLACED }),
  step("payments.ledger", "bus", "event", { ref: AUTHORIZED, status: "verified" }),
  step("bus", "shop.oms", "event", { ref: AUTHORIZED, status: "verified" }),
  step("shop.oms", "bus", "event", { ref: CONFIRMED }),
  step("bus", "delivery.core", "event", { ref: CONFIRMED }),
]);

describe("eventChain", () => {
  it("is empty for an event nobody consumes", () => {
    const chain = eventChain(estate([SAGA], { [CONFIRMED]: [] }), CONFIRMED);
    expect(chain.nodes).toEqual([]);
    expect(chain.count).toBe(0);
  });

  it("stops at a consumer no flow shows hearing the event", () => {
    const chain = eventChain(estate([]), PLACED);
    expect(outline(chain.nodes)).toEqual(["payments.ledger (declared)"]);
  });

  it("follows the receiving step into what the consumer publishes, and on", () => {
    const chain = eventChain(estate([SAGA]), PLACED);
    expect(outline(chain.nodes)).toEqual([
      "payments.ledger (declared)",
      "  in saga · step 3 (declared)",
      "    PaymentAuthorized · step 4 (verified)",
      "      shop.oms (verified)",
      "        in saga · step 5 (verified)",
      "          OrderConfirmed · step 6 (declared)",
      "            delivery.core (declared)",
      "              in saga · step 7 (declared)",
    ]);
    expect(chain.count).toBe(8);
    expect(chain.truncated).toBe(false);
  });

  it("hangs a receipt on the consumer it addresses, not on every consumer", () => {
    const c = estate([SAGA], {
      [PLACED]: [
        { service: "payments.ledger", status: "declared" },
        { service: "delivery.core", status: "declared" },
      ],
    });
    const [ledger, delivery] = eventChain(c, PLACED).nodes;
    expect(ledger?.children).toHaveLength(1);
    expect(delivery?.children).toEqual([]);
  });

  it("keeps consumers in the order the event lists them, and keeps the unknown ones", () => {
    const c = estate([], {
      [PLACED]: [
        { service: "analytics", status: "unresolved" },
        { service: "payments.ledger", status: "declared" },
      ],
    });
    const nodes = eventChain(c, PLACED).nodes;
    expect(nodes.map((x) => (x.kind === "consumer" ? [x.service, x.known] : null))).toEqual([
      ["analytics", false],
      ["payments.ledger", true],
    ]);
  });

  it("carries the provenance of a derived consumer", () => {
    const c = estate([], {
      [PLACED]: [{ service: "payments.ledger", status: "declared", via: { flow: "saga", step: "s3" } }],
    });
    const node = eventChain(c, PLACED).nodes[0];
    expect(node?.kind === "consumer" && node.via).toEqual({ flow: "saga", step: "s3" });
  });

  it("lists each published event once per receipt, at its first step", () => {
    const c = estate([
      flow("twice", [
        step("bus", "payments.ledger", "event", { ref: PLACED }),
        step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
        step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
      ]),
    ]);
    const receipt = eventChain(c, PLACED).nodes[0]?.children[0];
    expect(receipt?.children.map((e) => (e.kind === "event" ? e.number : null))).toEqual([2]);
  });

  it("does not count a relay of somebody else's event, or a publish before the receipt", () => {
    const c = estate([
      flow("relay", [
        step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
        step("bus", "payments.ledger", "event", { ref: PLACED }),
        step("payments.ledger", "bus", "event", { ref: PLACED }),
      ]),
    ]);
    const receipt = eventChain(c, PLACED).nodes[0]?.children[0];
    expect(receipt?.children).toEqual([]);
  });

  it("leaves out a publish from another arm of an alt the receipt sits in", () => {
    const c = estate([
      flow("alt", [
        {
          type: "alt",
          id: "alt1",
          branches: [
            {
              title: "accepted",
              steps: [
                step("bus", "payments.ledger", "event", { ref: PLACED }),
                step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
              ],
            },
            {
              title: "declined",
              steps: [step("payments.ledger", "bus", "event", { ref: AUTHORIZED, status: "verified" })],
            },
          ],
        },
        // Outside the alt: follows from either arm.
        step("payments.ledger", "bus", "event", { ref: CONFIRMED }),
      ]),
    ]);
    const receipt = eventChain(c, PLACED).nodes[0]?.children[0];
    expect(receipt?.children.map((e) => (e.kind === "event" ? [e.name, e.number] : null))).toEqual([
      ["PaymentAuthorized", 2],
    ]);
  });

  it("keeps a publish inside an alt the receipt is outside of: it is one of the things that can happen", () => {
    const c = estate([
      flow("cond", [
        step("bus", "payments.ledger", "event", { ref: PLACED }),
        {
          type: "alt",
          id: "alt1",
          branches: [
            { title: "ok", steps: [step("payments.ledger", "bus", "event", { ref: AUTHORIZED })] },
            { title: "no", steps: [step("payments.ledger", "payments.ledger", "call")] },
          ],
        },
      ]),
    ]);
    const receipt = eventChain(c, PLACED).nodes[0]?.children[0];
    expect(receipt?.children.map((e) => (e.kind === "event" ? e.name : null))).toEqual([
      "PaymentAuthorized",
    ]);
  });

  it("expands an event once in the whole tree, and says so the second time", () => {
    // Two consumers of OrderPlaced each publish PaymentAuthorized.
    const c = estate(
      [
        flow("one", [
          step("bus", "payments.ledger", "event", { ref: PLACED }),
          step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
          step("bus", "shop.oms", "event", { ref: AUTHORIZED }),
        ]),
        flow("two", [
          step("bus", "payments.ledger", "event", { ref: PLACED }),
          step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
        ]),
      ],
    );
    expect(outline(eventChain(c, PLACED).nodes)).toEqual([
      "payments.ledger (declared)",
      "  in one · step 1 (declared)",
      "    PaymentAuthorized · step 2 (declared)",
      "      shop.oms (verified)",
      "        in one · step 3 (declared)",
      "  in two · step 1 (declared)",
      "    PaymentAuthorized · step 2 (declared) [seen 1]",
    ]);
  });

  it("cuts a cycle where the chain would come back to an event already on the path", () => {
    const c = estate(
      [
        flow("loop", [
          step("bus", "payments.ledger", "event", { ref: PLACED }),
          step("payments.ledger", "bus", "event", { ref: AUTHORIZED }),
          step("bus", "shop.oms", "event", { ref: AUTHORIZED }),
          step("shop.oms", "bus", "event", { ref: PLACED }),
        ]),
      ],
    );
    const lines = outline(eventChain(c, PLACED).nodes);
    expect(lines.at(-1)).toBe("          OrderPlaced · step 4 (declared) [cycle 1]");
  });

  it("cuts at the depth limit and says how many consumers were not followed", () => {
    const chain = eventChain(estate([SAGA]), PLACED, { maxDepth: 1 });
    expect(outline(chain.nodes)).toEqual([
      "payments.ledger (declared)",
      "  in saga · step 3 (declared)",
      "    PaymentAuthorized · step 4 (verified) [depth 1]",
    ]);
  });

  it("stops at the node budget and says so", () => {
    const chain = eventChain(estate([SAGA]), PLACED, { maxNodes: 2 });
    expect(chain.truncated).toBe(true);
    expect(chain.count).toBe(2);
    expect(outline(chain.nodes)).toEqual([
      "payments.ledger (declared)",
      "  in saga · step 3 (declared) [budget 1]",
    ]);
  });

  it("rolls the worst status up", () => {
    const c = estate([SAGA], { [CONFIRMED]: [{ service: "warehouse", status: "unresolved" }] });
    const root = eventChain(c, PLACED).nodes[0];
    expect(root?.status).toBe("declared");
    expect(root?.worst).toBe("unresolved");
  });
});

describe("eventChain: the real catalog", () => {
  it("follows OrderPlaced into the ledger and back to oms", () => {
    const chain = eventChain(real, "shop.oms.order.OrderPlaced");
    const ledger = chain.nodes.find((x) => x.kind === "consumer" && x.service === "payments.ledger");
    const receipt = ledger?.children.find((r) => r.kind === "receipt" && r.flow === "order-accepted");
    expect(receipt?.kind === "receipt" && receipt.number).toBe(3);
    const authorized = receipt?.children.find((e) => e.kind === "event" && e.name === "PaymentAuthorized");
    expect(authorized?.children.map((x) => (x.kind === "consumer" ? x.service : null))).toContain(
      "shop.oms",
    );
    expect(chain.truncated).toBe(false);
  });

  it("follows the derived consumer: auth hears PasswordChanged and ends sessions", () => {
    const chain = eventChain(real, "auth.auth.user.PasswordChanged");
    expect(outline(chain.nodes)).toEqual([
      "auth.auth (declared)",
      "  in auth-revoke-sessions-on-password-change · step 1 (declared)",
      "    SessionEnded · step 6 (declared)",
    ]);
  });
});
