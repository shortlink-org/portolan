import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CelInput, suggestionsAt } from "./CelInput";

describe("what the CEL box offers at the cursor", () => {
  it("offers the subject's fields after `event.`, filtered by what is typed", () => {
    const text = "size(event.cons";
    const offer = suggestionsAt("event", text, text.length);
    expect(offer?.from).toBe("size(event.".length);
    expect(offer?.items).toEqual([
      { name: "consumers", type: "list<string>" },
    ]);
  });

  it("offers the estate's lists after `estate.`", () => {
    const text = "event.service in estate.s";
    expect(suggestionsAt("event", text, text.length)?.items.map((item) => item.name)).toEqual(["services", "stores"]);
  });

  it("offers nothing after another subject, a complete name, or away from a dot", () => {
    expect(suggestionsAt("event", "service.", 8)).toBeNull();
    expect(suggestionsAt("event", "event.name", 10)).toBeNull();
    expect(suggestionsAt("event", "size(", 5)).toBeNull();
  });

  it("reads the cursor, not the end of the text", () => {
    const text = "event. && true";
    expect(suggestionsAt("event", text, "event.".length)?.items.length).toBeGreaterThan(3);
  });
});

describe("the CEL box", () => {
  it("ties its compile error to the box", () => {
    const html = renderToStaticMarkup(<CelInput subject="event" label="Condition" value="event.nme" onChange={() => {}} error="invalid CEL: no such field" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"[^>]*>invalid CEL: no such field/);
  });
});
