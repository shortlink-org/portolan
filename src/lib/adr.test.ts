import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import {
  adrCoversService,
  adrNumber,
  adrsForService,
  isCurrent,
  newestAccepted,
  sortAdrs,
} from "./adr";
import type { Adr } from "../catalog";

function byId(id: string): Adr {
  const adr = catalog.adrs.find((a) => a.id === id);
  if (!adr) throw new Error(`no adr ${id}`);
  return adr;
}

describe("adrNumber", () => {
  it("pads to the four digits people write in commits", () => {
    expect(adrNumber(byId("org.0001"))).toBe("ADR-0001");
    expect(adrNumber(byId("shop.oms.0007"))).toBe("ADR-0007");
  });
});

describe("sortAdrs", () => {
  it("puts the newest decision first", () => {
    expect(sortAdrs(catalog.adrs).map((a) => a.id)).toEqual([
      "shop.oms.0007",
      "payments.0004",
      "shop.oms.0003",
      "org.0002",
      "org.0001",
    ]);
  });

  it("does not mutate its input", () => {
    const before = catalog.adrs.map((a) => a.id);
    sortAdrs(catalog.adrs);
    expect(catalog.adrs.map((a) => a.id)).toEqual(before);
  });
});

describe("isCurrent", () => {
  it("is false for records that no longer hold", () => {
    expect(isCurrent(byId("shop.oms.0003"))).toBe(false);
    expect(isCurrent(byId("shop.oms.0007"))).toBe(true);
    expect(isCurrent(byId("payments.0004"))).toBe(true);
  });
});

describe("adrCoversService", () => {
  const org = byId("org.0002");
  const context = byId("payments.0004");
  const service = byId("shop.oms.0007");
  const relates = byId("org.0001");

  it("lets an org decision govern every service", () => {
    expect(adrCoversService(org, "shop.pricing", "shop")).toBe(true);
    expect(adrCoversService(org, "delivery.core", "delivery")).toBe(true);
  });

  it("scopes a context decision to that context only", () => {
    expect(adrCoversService(context, "payments.ledger", "payments")).toBe(true);
    expect(adrCoversService(context, "shop.oms", "shop")).toBe(false);
  });

  it("scopes a service decision to that service only", () => {
    expect(adrCoversService(service, "shop.oms", "shop")).toBe(true);
    expect(adrCoversService(service, "shop.pricing", "shop")).toBe(false);
  });

  it("also covers services named in relates", () => {
    expect(relates.scope.kind).toBe("org");
    const narrowed: Adr = {
      ...relates,
      scope: { kind: "context", context: "shop" },
    };
    expect(adrCoversService(narrowed, "delivery.core", "delivery")).toBe(true);
    expect(adrCoversService(narrowed, "shop.pricing", "shop")).toBe(true);
    expect(adrCoversService(narrowed, "payments.ledger", "payments")).toBe(
      false,
    );
  });
});

describe("adrsForService", () => {
  it("lists everything governing shop.oms, newest first", () => {
    expect(
      adrsForService(catalog, "shop.oms", "shop").map((a) => a.id),
    ).toEqual(["shop.oms.0007", "shop.oms.0003", "org.0002", "org.0001"]);
  });

  it("gives shop.pricing only the org-wide decisions", () => {
    expect(
      adrsForService(catalog, "shop.pricing", "shop").map((a) => a.id),
    ).toEqual(["org.0002", "org.0001"]);
  });

  it("gives payments.ledger its own context's decision too", () => {
    expect(
      adrsForService(catalog, "payments.ledger", "payments").map((a) => a.id),
    ).toEqual(["payments.0004", "org.0002", "org.0001"]);
  });
});

describe("newestAccepted", () => {
  it("skips proposed and superseded records", () => {
    expect(newestAccepted(catalog, 5).map((a) => a.id)).toEqual([
      "shop.oms.0007",
      "org.0002",
      "org.0001",
    ]);
  });

  it("honours the limit", () => {
    expect(newestAccepted(catalog, 1).map((a) => a.id)).toEqual([
      "shop.oms.0007",
    ]);
  });
});

describe("decision pages draw nothing from the current model", () => {
  it("never reaches for a LikeC4 view", () => {
    // A record is frozen history. Rendering a live view inside one would make
    // it re-draw from a model that has moved on since the decision was taken.
    const source = readFileSync("src/pages/AdrDetail.tsx", "utf8");
    expect(source).not.toMatch(/LikeC4View|C4View|FlowView|likec4/);
  });
});
