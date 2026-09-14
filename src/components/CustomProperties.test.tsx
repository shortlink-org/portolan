import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomPropertiesContent, PropertyValue } from "./CustomProperties";
import type { CatalogAnnotation } from "../catalog";

describe("property presentation", () => {
  it("omits empty reader sections and exposes authoring only with a capability", () => {
    expect(renderToStaticMarkup(<CustomPropertiesContent />)).toBe("");
    expect(renderToStaticMarkup(<CustomPropertiesContent onEdit={() => {}} />)).toContain("Add resources or properties");
  });
  it("renders useful links once, explicit values and provenance without mutation controls", () => {
    const annotation: CatalogAnnotation = { version: 1, catalog: "default", target: { kind: "service", id: "shop.oms" }, source: "annotations/default/service/shop.oms.json", basis: "declared", properties: {
      "x-runbook": { type: "link", label: "Runbook", value: { url: "https://docs.example.com/runbook", label: "Recover orders", purpose: "runbook" } },
      "x-rto": { type: "number", label: "RTO", value: 0, unit: "min" },
      "x-ready": { type: "boolean", label: "Ready", value: false },
    }, order: ["x-runbook", "x-rto", "x-ready"] };
    const html = renderToStaticMarkup(<CustomPropertiesContent annotation={annotation} />);
    expect(html.match(/href="https:\/\/docs.example.com\/runbook"/g)).toHaveLength(1);
    expect(html).toContain("docs.example.com"); expect(html).toContain("Copy Runbook URL");
    expect(html).toContain("0 min"); expect(html).toContain(">No<"); expect(html).toContain("declared");
    expect(html).not.toContain("Add property"); expect(html).not.toContain("Edit Runbook");
  });
  it("escapes authored text and never renders unsafe URLs as links", () => {
    expect(renderToStaticMarkup(<PropertyValue property={{ type: "text", label: "Note", value: "<script>alert(1)</script>" }} />)).toContain("&lt;script&gt;");
    expect(renderToStaticMarkup(<PropertyValue property={{ type: "link", label: "Bad", value: { url: "javascript:alert(1)", label: "Bad", purpose: "generic" } }} />)).not.toContain("href");
    expect(renderToStaticMarkup(<PropertyValue property={{ type: "json", label: "Empty", value: {} }} />)).toContain("Object · 0 fields");
  });
});
