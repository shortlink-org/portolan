import { describe, expect, it } from "vitest";
import { applyAnnotations, propertyError, validateAnnotationDocument, validateCatalogAnnotations } from "./annotations.mjs";
import { editPropertyDocument, propertyDraft } from "./property-editor";
import { filterCatalogForProfile } from "../catalog-profile";
import { mergeCatalogs } from "../merge";
import { validateCatalog } from "../catalog";
import type { AnnotationDocument, Catalog, CatalogAnnotation } from "../catalog";
import { rawCatalog } from "../test-catalog";

const base: AnnotationDocument = { version: 1, catalog: "example", target: { kind: "service", id: "shop.oms" }, properties: {}, order: [] };
const annotation = (): CatalogAnnotation => ({ ...structuredClone(base), source: "annotations/example/service/shop.oms.json", basis: "declared" });

describe("authored properties", () => {
  it("preserves false, zero, empty text and collections through editing and validation", () => {
    let doc = structuredClone(base);
    for (const [key, p] of Object.entries({
      "x-flag": { type: "boolean" as const, label: "Flag", value: false },
      "x-rto": { type: "number" as const, label: "RTO", value: 0, unit: "min" },
      "x-note": { type: "text" as const, label: "Note", value: "" },
      "x-tags": { type: "tags" as const, label: "Tags", value: [] },
      "x-data": { type: "json" as const, label: "Data", value: { ready: false, count: 0, tags: [] } },
    })) doc = editPropertyDocument(doc, propertyDraft(key, p), null);
    expect(validateAnnotationDocument(doc)).toEqual(doc);
    expect(doc.properties["x-rto"]!.value).toBe(0);
    expect(doc.properties["x-flag"]!.value).toBe(false);
    const removed = editPropertyDocument(doc, propertyDraft("x-rto", doc.properties["x-rto"]), "x-rto", true);
    expect(removed.order).not.toContain("x-rto");
    expect(doc.order).toContain("x-rto");
  });
  it("rejects unsafe links, invalid types, duplicate keys and invalid ordering", () => {
    expect(() => validateAnnotationDocument({ ...base, catalog: 123 })).toThrow(/catalog id/);
    for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "https://user:secret@example.com", "//example.com"]) expect(propertyError({ type: "link", label: "Link", value: { label: "Open", purpose: "generic", url } })).toBeTruthy();
    expect(propertyError({ type: "number", label: "Count", value: Infinity })).toBeTruthy();
    expect(propertyError({ type: "boolean", label: "Flag", value: "false" })).toBeTruthy();
    expect(propertyError({ type: "json", label: "Data", value: null })).toBeTruthy();
    const doc = editPropertyDocument(base, propertyDraft("x-note", { type: "text", label: "Note", value: "hello" }), null);
    expect(() => editPropertyDocument(doc, propertyDraft("x-note", { type: "text", label: "Other", value: "test" }), null)).toThrow(/already exists/);
    expect(() => validateAnnotationDocument({ ...doc, order: [] })).toThrow(/order/);
  });
  it("merges authored data, filters profiles and preserves orphan diagnostics without changing evidence", () => {
    const full = structuredClone(rawCatalog) as Catalog;
    const service = full.contexts[0]!.services[0]!;
    const context = full.contexts[0]!;
    const known = { ...annotation(), target: { kind: "service" as const, id: service.id } };
    const other = { ...known, catalog: "other", source: "annotations/other/service/test.json" };
    const missing = { ...annotation(), target: { kind: "service" as const, id: "gone" }, source: "annotations/example/service/gone.json" };
    const result = applyAnnotations(full, [known, other, missing], "example");
    expect(result.contexts).toBe(full.contexts);
    expect(result.annotations?.find((a) => a.target.id === "gone")?.unresolved).toBe(true);
    const profile = { id: "example", title: "Example", sources: [], contexts: [context.id], projects: [] };
    expect(filterCatalogForProfile(result, profile).annotations).toHaveLength(2);
    expect(filterCatalogForProfile(result, { ...profile, contexts: ["excluded"] }).annotations).toEqual([expect.objectContaining({ unresolved: true })]);
    const merged = mergeCatalogs([{ path: "one.json", catalog: result }]).catalog;
    expect(merged.annotations).toEqual(result.annotations);
    expect(() => validateCatalog(merged)).not.toThrow();
    expect(() => validateCatalogAnnotations([known, known])).toThrow(/Duplicate/);
  });
});
