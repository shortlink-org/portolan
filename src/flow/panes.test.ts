import { describe, expect, it } from "vitest";
import type { Flow } from "../catalog";
import { closePane, doorKey, openPane, paneOfRow, paneParent, paneSlug, panesOf, readPanes, writePanes } from "./panes";
import type { Continuation } from "./continues";

const flow = (slug: string): Flow => ({
  id: `test.${slug}`,
  slug,
  name: slug.replace(/-/g, " "),
  summary: "",
  owner: "shop",
  participants: [],
  steps: [],
});

const via = (slug: string): Continuation => ({ slug, name: slug, kind: "contract", basis: "x", confidence: "high" });

const flows = [flow("cart-checkout"), flow("auth-validate-session"), flow("ledger-authorize")];

describe("what a door is called", () => {
  it("names the flow it leads to, and the pane it was opened from", () => {
    const first = doorKey(null, "s2", via("auth-validate-session"));
    expect(first).toBe("s2>auth-validate-session");
    const deeper = doorKey(first, "t4", via("ledger-authorize"));
    expect(deeper).toBe("s2>auth-validate-session/t4>ledger-authorize");
    expect(paneSlug(deeper)).toBe("ledger-authorize");
    expect(paneParent(deeper)).toBe(first);
    expect(paneParent(first)).toBeNull();
  });
});

describe("what the address carries", () => {
  it("is the keys in the order they were opened", () => {
    expect(readPanes("a>one,b>two")).toEqual(["a>one", "b>two"]);
    expect(readPanes(null)).toEqual([]);
    expect(readPanes(" , a>one , ")).toEqual(["a>one"]);
    expect(writePanes(["a>one", "b>two"])).toBe("a>one,b>two");
  });
});

describe("opening and closing", () => {
  it("appends, and opens nothing twice", () => {
    expect(openPane([], "s2>auth-validate-session")).toEqual(["s2>auth-validate-session"]);
    expect(openPane(["s2>auth-validate-session"], "s2>auth-validate-session")).toEqual(["s2>auth-validate-session"]);
    expect(openPane(["a>one"], "b>two")).toEqual(["a>one", "b>two"]);
  });

  it("closes what was opened from what is closed", () => {
    const keys = ["s2>auth-validate-session", "s2>auth-validate-session/t4>ledger-authorize", "s6>other"];
    expect(closePane(keys, "s2>auth-validate-session")).toEqual(["s6>other"]);
    expect(closePane(keys, "s6>other")).toEqual(keys.slice(0, 2));
  });
});

describe("the documents themselves", () => {
  it("resolve in the order they were opened", () => {
    const panes = panesOf(["s2>auth-validate-session", "s2>auth-validate-session/t4>ledger-authorize"], flows);
    expect(panes.map((pane) => pane.flow.slug)).toEqual(["auth-validate-session", "ledger-authorize"]);
    expect(panes.map((pane) => pane.parent)).toEqual([null, "s2>auth-validate-session"]);
  });

  it("drop a key the catalog has no flow for, and one read through it", () => {
    const keys = ["s2>gone", "s2>gone/t1>ledger-authorize", "s3>auth-validate-session"];
    expect(panesOf(keys, flows).map((pane) => pane.flow.slug)).toEqual(["auth-validate-session"]);
  });
});

describe("which document a row is read in", () => {
  const keys = ["s2>auth-validate-session", "s2>auth-validate-session/t4>ledger-authorize"];

  it("is the deepest open document its key runs through", () => {
    expect(paneOfRow(keys, "s2>auth-validate-session/t4")).toBe("s2>auth-validate-session");
    expect(paneOfRow(keys, "s2>auth-validate-session/t4>ledger-authorize/u1")).toBe(
      "s2>auth-validate-session/t4>ledger-authorize",
    );
  });

  it("is nothing for a step of the flow on the page", () => {
    expect(paneOfRow(keys, "s2")).toBeNull();
    expect(paneOfRow(keys, "s2>auth-validate-session")).toBeNull();
  });
});
