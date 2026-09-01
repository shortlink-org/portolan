import { describe, expect, it } from "vitest";
import {
  compareDate,
  compareKind,
  compareStatus,
  compareText,
  compareVersion,
  comparatorFor,
} from "./compare";

const sorted = (values: string[], cmp: (a: string, b: string) => number) =>
  [...values].sort(cmp);

describe("compareVersion", () => {
  it("orders by segment value, not by spelling", () => {
    expect(sorted(["v10", "v2", "v1"], compareVersion)).toEqual([
      "v1",
      "v2",
      "v10",
    ]);
  });

  it("compares every segment numerically", () => {
    expect(sorted(["1.10.0", "1.2.0", "1.9.30"], compareVersion)).toEqual([
      "1.2.0",
      "1.9.30",
      "1.10.0",
    ]);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersion("1.2", "1.2.0")).toBe(0);
  });

  it("ignores a leading v on either side", () => {
    expect(compareVersion("v3", "3")).toBe(0);
  });

  it("puts a prerelease before the release it leads to", () => {
    expect(sorted(["1.0.0", "1.0.0-rc.1", "1.0.0-alpha"], compareVersion)).toEqual(
      ["1.0.0-alpha", "1.0.0-rc.1", "1.0.0"],
    );
  });

  it("compares numeric prerelease identifiers as numbers", () => {
    expect(compareVersion("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
  });

  it("keeps the whole prerelease when it contains a hyphen", () => {
    // Truncating at the second hyphen would make these two the same version.
    expect(compareVersion("1.0.0-rc-2", "1.0.0-rc")).not.toBe(0);
    expect(compareVersion("1.0.0-rc-2", "1.0.0-rc-2")).toBe(0);
  });

  it("drops build metadata from precedence", () => {
    expect(compareVersion("1.0.0+abc", "1.0.0+zzz")).toBe(0);
  });

  it("sorts anything unversioned after every version", () => {
    expect(sorted(["latest", "v2", "v1"], compareVersion)).toEqual([
      "v1",
      "v2",
      "latest",
    ]);
  });
});

describe("compareStatus", () => {
  it("orders verified, declared, unresolved", () => {
    expect(sorted(["unresolved", "verified", "declared"], compareStatus)).toEqual(
      ["verified", "declared", "unresolved"],
    );
  });

  it("puts a value outside the vocabulary last", () => {
    expect(compareStatus("verified", "made up")).toBeLessThan(0);
  });
});

describe("compareKind", () => {
  it("orders by the taxonomy, not the alphabet", () => {
    expect(
      sorted(["vo", "query", "event", "entity", "command"], compareKind),
    ).toEqual(["event", "command", "query", "entity", "vo"]);
  });
});

describe("compareDate", () => {
  it("orders oldest first", () => {
    expect(compareDate("2024-01-01", "2024-02-01")).toBeLessThan(0);
  });

  it("falls back to text when neither side parses", () => {
    expect(compareDate("someday", "never")).toBe(compareText("someday", "never"));
  });
});

describe("compareText", () => {
  it("ignores case first and breaks the tie deterministically", () => {
    expect(compareText("alpha", "Beta")).toBeLessThan(0);
    expect(compareText("a", "A")).not.toBe(0);
  });
});

describe("comparatorFor", () => {
  it("sorts counts as numbers rather than strings", () => {
    const cmp = comparatorFor("count");
    expect(cmp(9, 10)).toBeLessThan(0);
  });

  it("puts undefined last whichever side it is on", () => {
    const cmp = comparatorFor("text");
    expect(cmp(undefined, "a")).toBeGreaterThan(0);
    expect(cmp("a", undefined)).toBeLessThan(0);
    expect(cmp(undefined, undefined)).toBe(0);
  });
});
