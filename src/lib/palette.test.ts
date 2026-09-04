import { describe, expect, it } from "vitest";
import { catalog as shipped } from "../data";
import { catalog } from "../testing/estate";
import { excerptOf, flattenProse, paletteItems, search } from "./palette";
import { isRoutable } from "../routes";
import { allEvents } from "../catalog";
import { registryCatalog } from "./scenarios";

const items = paletteItems(catalog);
const rows = (raw: string, limit?: number) =>
  search(items, raw, limit).hits.map((h) => h.item);
const kinds = (raw: string) => new Set(rows(raw).map((i) => i.kind));

describe("palette index", () => {
  it("indexes every kind, and every row goes somewhere real", () => {
    // Against what the app ships: the routes are built from the live catalog,
    // and a row of the frozen estate has nowhere real to go.
    const items = paletteItems(shipped);
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set([
        "def",
        "endpoint",
        "context",
        "service",
        "aggregate",
        "event",
        "vo",
        "entity",
        "command",
        "query",
        "store",
        "table",
        "view",
        "flow",
        "adr",
        "module",
      ]),
    );
    for (const item of items) {
      // Shared types are the one kind with no page; everything else routes.
      if (item.path === null) {
        expect(item.kind, item.id).toBe("def");
        continue;
      }
      expect(isRoutable(item.path), `${item.id} -> ${item.path}`).toBe(true);
    }
  });

  it("gives every row a unique id, so rows never collide as keys", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("indexes one row per event, badged with its latest version", () => {
    const events = items.filter((i) => i.kind === "event");
    expect(events).toHaveLength(allEvents(catalog).length);
    const placed = events.find((e) => e.id === "shop.oms.order.OrderPlaced");
    expect(placed?.badge).toBe("v2");
  });

  it("marks selectable rows, and only those the selection model resolves", () => {
    const selectable = new Set(
      items.filter((i) => i.selectId).map((i) => i.kind),
    );
    expect(selectable).toEqual(
      new Set([
        "context",
        "service",
        "aggregate",
        "event",
        "def",
        "store",
        "table",
        "view",
        "module",
      ]),
    );
    // A value object has a page but is not a selectable entity; it navigates.
    const money = items.find((i) => i.id === "shop.oms.order.money");
    expect(money?.selectId).toBeUndefined();
    expect(money?.path).toBe("/c/shop/oms/order/vo/money");
  });

  it("lists a shared type apart from the value objects that name it", () => {
    const def = items.find((i) => i.id === "def:Money");
    expect(def?.kind).toBe("def");
    expect(def?.selectId).toBe("Money");
    expect(def?.path).toBeNull();
    const vos = items.filter((i) => i.kind === "vo" && i.name === "Money");
    expect(vos.length).toBeGreaterThan(1);
  });

  it("badges the entity an aggregate calls its root", () => {
    const order = items.find((i) => i.id === "shop.oms.order.order");
    expect(order?.kind).toBe("entity");
    expect(order?.badge).toBe("root");
  });
});

describe("prefix filters", () => {
  it("restricts to one kind and searches within it", () => {
    expect(kinds("e: order")).toEqual(new Set(["event"]));
    expect(kinds("vo: money")).toEqual(new Set(["vo"]));
    expect(kinds("agg:")).toEqual(new Set(["aggregate"]));
    expect(kinds("cmd: place")).toEqual(new Set(["command"]));
    expect(kinds("q: get")).toEqual(new Set(["query"]));
    expect(kinds("type: money")).toEqual(new Set(["def"]));
  });

  it("finds the value objects called Money and not the events holding one", () => {
    const found = rows("vo: money");
    expect(found.length).toBeGreaterThan(1);
    expect(found.every((i) => i.name === "Money")).toBe(true);
    // Money is a shared kernel type: several aggregates name it.
    expect(new Set(found.map((i) => i.detail)).size).toBe(found.length);
  });

  it("echoes the parse back so the palette can show what it understood", () => {
    const result = search(items, "e: item");
    expect(result.kind).toBe("event");
    expect(result.prefix).toBe("e");
    expect(result.term).toBe("item");
  });
});

describe("ranking", () => {
  it("puts an exact name above a partial one", () => {
    const first = rows("Money")[0];
    expect(first?.name).toBe("Money");
  });

  it("prefers a name match to an id or owner match", () => {
    expect(rows("OrderPlaced")[0]?.id).toBe("shop.oms.order.OrderPlaced");
  });

  it("matches at word boundaries inside a camelCase name", () => {
    const names = rows("cmd: item").map((i) => i.name);
    expect(names).toContain("AddItem");
    expect(names).toContain("RemoveItem");
  });

  it("returns nothing rather than everything for a miss", () => {
    const result = search(items, "zzzzz");
    expect(result.hits).toEqual([]);
    expect(result.truncated).toBe(0);
  });

  it("reports what the limit dropped", () => {
    const result = search(items, "", 5);
    expect(result.hits).toHaveLength(5);
    expect(result.truncated).toBe(items.length - 5);
  });
});

describe("prose", () => {
  it("finds an aggregate by an invariant nobody knows the name of", () => {
    const hit = search(items, "un-cancel").hits[0];
    expect(hit?.item.id).toBe("shop.oms.order");
    // A prose hit must say why it is here, or the reader has to open it.
    expect(hit?.excerpt?.match).toBe("un-cancel");
    expect(hit?.excerpt?.before).toContain("terminal");
  });

  it("finds a decision by what its body argues, not by its number", () => {
    const found = rows("QueryWorkflow").map((i) => i.id);
    expect(found).toContain("shop.oms.0003");
  });

  it("searches field docs, so a shape is findable by what it means", () => {
    // FxRate.rateMicros: "An integer on purpose: a float rate cannot be
    // reproduced exactly from a stored posting."
    expect(rows("float rate").map((i) => i.id)).toContain("def:FxRate");
  });

  it("never lets a prose hit displace a name", () => {
    const found = rows("Money");
    const firstProse = found.findIndex(
      (i) => !i.name.toLowerCase().includes("money"),
    );
    const lastName = found.reduce(
      (at, i, n) => (i.name.toLowerCase().includes("money") ? n : at),
      -1,
    );
    if (firstProse >= 0) expect(firstProse).toBeGreaterThan(lastName);
  });

  it("holds the prose tier shut for a term too short to mean anything", () => {
    // "or" is in half the readmes in the catalog and names nothing.
    expect(
      rows("or").every((i) =>
        `${i.name} ${i.id} ${i.detail}`.toLowerCase().includes("or"),
      ),
    ).toBe(true);
  });

  it("carries no excerpt on a row that matched by name", () => {
    expect(search(items, "OrderPlaced").hits[0]?.excerpt).toBeUndefined();
  });
});

describe("flattenProse", () => {
  it("drops fenced code, which matches identifiers and answers nothing", () => {
    expect(
      flattenProse("keep this\n\n```go\nfunc Secret() {}\n```\n\nand this"),
    ).toBe("keep this and this");
  });

  it("strips the marks so bold prose is found by typing the word", () => {
    expect(flattenProse("it is **never** set")).toBe("it is never set");
  });
});

describe("excerptOf", () => {
  it("returns the match verbatim, with the words either side", () => {
    const cut = excerptOf(
      "the total is recomputed on every mutation",
      "recomputed",
    );
    expect(cut?.match).toBe("recomputed");
    expect(`${cut?.before}${cut?.match}${cut?.after}`).toBe(
      "the total is recomputed on every mutation",
    );
  });

  it("marks with an ellipsis the ends it cut", () => {
    const long = "x".repeat(200) + " needle " + "y".repeat(200);
    const cut = excerptOf(long, "needle");
    expect(cut?.before.startsWith("…")).toBe(true);
    expect(cut?.after.endsWith("…")).toBe(true);
  });

  it("is not a regex: a term full of punctuation still matches itself", () => {
    expect(excerptOf("see events/v1 for the shape", "events/v1")?.match).toBe(
      "events/v1",
    );
  });

  it("says nothing when the text does not hold the term", () => {
    expect(excerptOf("nothing here", "needle")).toBeNull();
  });
});

// A prefix that finds nothing is a prefix that lies, so the entries it
// restricts to have to exist.
describe("endpoints", () => {
  it("finds an interface method by name, under its own prefix", () => {
    const found = rows("api: registerUser");
    expect(found[0]?.kind).toBe("endpoint");
    expect(found[0]?.id).toBe("auth.v1.Users/registerUser");
    expect(found[0]?.detail).toBe("auth.v1.Users");
  });
});

describe("modules in the palette", () => {
  const registry = paletteItems(registryCatalog());
  const modules = registry.filter((item) => item.kind === "module");

  it("lists one row per module, named the way a reader says it", () => {
    expect(modules.map((m) => m.name).sort()).toEqual([
      "acme/huge",
      "acme/shop",
    ]);
  });

  const hits = (raw: string) =>
    search(registry, raw, 20).hits.map((h) => h.item);

  it("finds a module by the name pasted into a buf.yaml", () => {
    expect(hits("acme/shop").some((i) => i.kind === "module")).toBe(true);
  });

  // "which module declares shop.v1?" is a question people arrive with, and
  // the module page is the only thing that answers it.
  it("finds a module by a package inside it", () => {
    expect(hits("shop.events.v1").find((i) => i.kind === "module")?.name).toBe(
      "acme/shop",
    );
  });

  it("points a module row at its page", () => {
    for (const module of modules) {
      expect(isRoutable(module.path ?? ""), module.name).toBe(true);
    }
  });

  // The app's own catalog has published exactly one module, and shows exactly
  // one row for it: a row per module, never an empty group.
  it("adds one row per module the estate has published", () => {
    expect(paletteItems(shipped).filter((i) => i.kind === "module").map((i) => i.id)).toEqual([
      "buf.build/shortlink-org/portolan-shop-order",
    ]);
  });
});

describe("a flow is found by what runs through it", () => {
  const items = paletteItems(catalog);
  const flows = (term: string) =>
    search(items, term).hits.filter((h) => h.item.kind === "flow");

  it("matches a step's rpc, and says which", () => {
    const hit = flows("Pricing/GetQuote")[0];
    expect(hit?.item.name).toBe("checkout");
    expect(hit?.excerpt).toEqual({ before: "runs through ", match: "shop.v1.Pricing/GetQuote", after: "" });
  });

  it("matches a lane the flow crosses", () => {
    expect(flows("psp-gateway").map((h) => h.item.name)).toContain("gateway-webhook");
  });

  it("ranks the flow's own name above a flow that merely mentions it", () => {
    const names = flows("checkout").map((h) => h.item.name);
    expect(names[0]).toBe("checkout");
  });

  it("carries the flow's health as its badge", () => {
    const login = items.find((i) => i.kind === "flow" && i.name === "auth-login");
    expect(login?.badge).toBe("unresolved");
  });

  it("does not answer a two-letter term from keywords", () => {
    expect(flows("ms").length).toBe(0);
  });
});
