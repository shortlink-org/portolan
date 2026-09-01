import { describe, expect, it } from "vitest";
import {
  PIN_CAP,
  addPin,
  isPinned,
  movePin,
  parsePins,
  removePin,
  serializePins,
} from "./pins";
import type { Pin } from "./pins";

const pin = (n: number): Pin => ({ kind: "event", id: `e${n}` });
const many = (n: number): Pin[] => Array.from({ length: n }, (_, i) => pin(i));

describe("addPin", () => {
  it("appends, so the newest pin is the one at the bottom", () => {
    const { pins } = addPin([pin(0)], pin(1));
    expect(pins.map((p) => p.id)).toEqual(["e0", "e1"]);
  });

  it("pins the same thing once, whatever a second click means", () => {
    const start = [pin(0)];
    expect(addPin(start, pin(0)).pins).toBe(start);
  });

  it("tells the two kinds of the same id apart", () => {
    const { pins } = addPin(
      [{ kind: "event", id: "x" }],
      { kind: "table", id: "x" },
    );
    expect(pins).toHaveLength(2);
  });

  it("drops the oldest at the cap rather than refusing the new one", () => {
    const full = many(PIN_CAP);
    const { pins, evicted } = addPin(full, pin(99));
    expect(pins).toHaveLength(PIN_CAP);
    expect(evicted).toEqual(pin(0));
    expect(pins[0]).toEqual(pin(1));
    expect(pins[PIN_CAP - 1]).toEqual(pin(99));
  });

  it("evicts nothing while there is still room", () => {
    expect(addPin(many(PIN_CAP - 1), pin(99)).evicted).toBeNull();
  });
});

describe("removePin", () => {
  it("takes one out and leaves the order of the rest alone", () => {
    expect(removePin(many(3), pin(1)).map((p) => p.id)).toEqual(["e0", "e2"]);
  });
});

describe("movePin", () => {
  it("moves a pin down, closing the gap behind it", () => {
    expect(movePin(many(4), 0, 2).map((p) => p.id)).toEqual([
      "e1",
      "e2",
      "e0",
      "e3",
    ]);
  });

  it("moves a pin up", () => {
    expect(movePin(many(4), 3, 1).map((p) => p.id)).toEqual([
      "e0",
      "e3",
      "e1",
      "e2",
    ]);
  });

  it("leaves the list untouched for a drop that goes nowhere", () => {
    const start = many(3);
    expect(movePin(start, 1, 1)).toBe(start);
    expect(movePin(start, -1, 0)).toBe(start);
    expect(movePin(start, 0, 9)).toBe(start);
  });
});

describe("parsePins", () => {
  it("round-trips what it wrote", () => {
    const pins = many(3);
    expect(parsePins(serializePins(pins))).toEqual(pins);
  });

  it("treats anything that is not a pin list as no pins at all", () => {
    expect(parsePins(null)).toEqual([]);
    expect(parsePins("")).toEqual([]);
    expect(parsePins("{not json")).toEqual([]);
    expect(parsePins('{"kind":"event"}')).toEqual([]);
  });

  it("drops entries an older build wrote and this one cannot draw", () => {
    const raw = JSON.stringify([
      { kind: "event", id: "e0" },
      { kind: "column", id: "c1" }, // a kind that is no longer pinnable
      { kind: "event" }, // no id
      { kind: "event", id: "" }, // empty id
      null,
      "flow.checkout",
      { kind: "adr", id: "shop.oms.0007" },
    ]);
    expect(parsePins(raw)).toEqual([
      { kind: "event", id: "e0" },
      { kind: "adr", id: "shop.oms.0007" },
    ]);
  });

  it("de-duplicates and holds the cap, whatever storage says", () => {
    const raw = JSON.stringify([...many(PIN_CAP + 4), pin(0)]);
    const parsed = parsePins(raw);
    expect(parsed).toHaveLength(PIN_CAP);
    expect(new Set(parsed.map((p) => `${p.kind}:${p.id}`)).size).toBe(PIN_CAP);
  });
});

describe("isPinned", () => {
  it("matches on kind and id together", () => {
    const pins: Pin[] = [{ kind: "flow", id: "flow.checkout" }];
    expect(isPinned(pins, { kind: "flow", id: "flow.checkout" })).toBe(true);
    expect(isPinned(pins, { kind: "adr", id: "flow.checkout" })).toBe(false);
  });
});
