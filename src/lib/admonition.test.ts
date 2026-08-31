import { describe, expect, it } from "vitest";
import { ADMONITION_KINDS, ADMONITION_LABEL, parseAdmonition } from "./admonition";

describe("GitHub admonitions", () => {
  it("labels every kind it claims to know", () => {
    for (const kind of ADMONITION_KINDS) {
      expect(ADMONITION_LABEL[kind], kind).toBeTruthy();
    }
  });

  it("reads the marker and hands back the body", () => {
    for (const kind of ADMONITION_KINDS) {
      const marker = `[!${kind.toUpperCase()}]`;
      expect(parseAdmonition(`${marker}\nMind this.`)).toEqual({
        kind,
        rest: "Mind this.",
      });
    }
  });

  it("accepts a marker that stands alone", () => {
    expect(parseAdmonition("[!NOTE]")).toEqual({ kind: "note", rest: "" });
    expect(parseAdmonition("[!NOTE]\n")).toEqual({ kind: "note", rest: "" });
  });

  it("tolerates the case and the trailing spaces a writer leaves behind", () => {
    expect(parseAdmonition("[!Warning]  \nCareful.")).toEqual({
      kind: "warning",
      rest: "Careful.",
    });
  });

  it("keeps the rest of a multi-line body intact", () => {
    expect(parseAdmonition("[!TIP]\nfirst\nsecond")?.rest).toBe(
      "first\nsecond",
    );
  });

  it("refuses anything that is not a bare marker line", () => {
    expect(parseAdmonition("[!NOTE] on the same line")).toBeNull();
    expect(parseAdmonition("[!HINT]\nnot a GitHub kind")).toBeNull();
    expect(parseAdmonition("A quotation.")).toBeNull();
    expect(parseAdmonition("text before\n[!NOTE]\nafter")).toBeNull();
  });
});
