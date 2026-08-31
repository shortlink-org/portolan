import { describe, expect, it } from "vitest";
import { absoluteTime, relativeTime } from "./format";

const now = new Date("2026-08-31T12:00:00Z");

describe("relativeTime", () => {
  it("collapses recent times", () => {
    expect(relativeTime("2026-08-31T11:59:50Z", now)).toBe("just now");
  });
  it("counts minutes, hours, days", () => {
    expect(relativeTime("2026-08-31T11:00:00Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-08-29T12:00:00Z", now)).toBe("2 days ago");
  });
  it("passes through unparseable input", () => {
    expect(relativeTime("not-a-date", now)).toBe("not-a-date");
  });
});

describe("absoluteTime", () => {
  it("renders a compact UTC stamp", () => {
    expect(absoluteTime("2026-08-29T09:14:22Z")).toBe("2026-08-29 09:14:22Z");
  });
});
