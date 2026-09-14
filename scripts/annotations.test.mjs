import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { annotationState, readAnnotations, saveAnnotation } from "./annotations.mjs";
import { loadCatalog } from "./catalog-sources.mjs";

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "portolan-properties-")); roots.push(root);
  const fragment = { contexts: [{ id: "shop", slug: "shop", name: "Shop", summary: "", services: [] }], defs: {}, flows: [], adrs: [] };
  writeFileSync(join(root, "source.json"), JSON.stringify(fragment));
  writeFileSync(join(root, "portolan.json"), JSON.stringify({ sources: [join(root, "source.json")], projects: [], extract: [] }));
  return root;
}
const target = { kind: "context", id: "shop" };
function request(state) { return { revision: state.revision, fileRevision: state.fileRevision, document: { ...state.document, properties: { "x-count": { type: "number", label: "Count", value: 0 }, "x-enabled": { type: "boolean", label: "Enabled", value: false } }, order: ["x-count", "x-enabled"] } }; }

describe("annotation files", () => {
  it("writes only workspace authoring files and reads them through generation repeatedly", async () => {
    const root = workspace(); const source = readFileSync(join(root, "source.json"), "utf8");
    const initial = annotationState(root, "default", target);
    expect(initial).toMatchObject({ writable: true, fileRevision: null });
    const saved = saveAnnotation(root, request(initial));
    expect(saved.document.properties["x-count"].value).toBe(0);
    expect(saved.document.properties["x-enabled"].value).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "portolan.json"), "utf8")).annotations).toBe("annotations/default");
    const file = readFileSync(join(root, saved.path), "utf8");
    for (let i = 0; i < 2; i++) {
      const loaded = await loadCatalog(join(root, "portolan.json"));
      expect(loaded.catalog.annotations[0]).toMatchObject({ basis: "declared", source: saved.path, properties: saved.document.properties });
      expect(loaded.sources.map((source) => source.path)).toContain(saved.path);
    }
    expect(readFileSync(join(root, saved.path), "utf8")).toBe(file);
    expect(readFileSync(join(root, "source.json"), "utf8")).toBe(source);
  });
  it("rejects stale edits and stale creation without discarding the disk version", () => {
    const root = workspace(); const first = annotationState(root, "default", target);
    const saved = saveAnnotation(root, request(first));
    expect(() => saveAnnotation(root, request(first))).toThrow(/changed on disk/);
    const next = request(saved); next.document.properties["x-count"].value = 7;
    const changed = saveAnnotation(root, next);
    expect(() => saveAnnotation(root, request(saved))).toThrow(/changed on disk/);
    expect(annotationState(root, "default", target).document.properties["x-count"].value).toBe(7);
    expect(changed.fileRevision).not.toBe(saved.fileRevision);
  });
  it("preserves missing targets but refuses new writes to them", async () => {
    const root = workspace(); saveAnnotation(root, request(annotationState(root, "default", target)));
    writeFileSync(join(root, "source.json"), JSON.stringify({ contexts: [], defs: {}, flows: [], adrs: [] }));
    const state = annotationState(root, "default", target);
    expect(state.writable).toBe(false);
    expect(() => saveAnnotation(root, request(state))).toThrow(/missing/);
    const loaded = await loadCatalog(join(root, "portolan.json"));
    expect(loaded.catalog.annotations[0].unresolved).toBe(true);
    expect(loaded.conflicts[0].message).toMatch(/target missing/);
  });
  it("rejects symlink storage, misplaced documents and unsafe values", () => {
    const root = workspace(); const external = workspace();
    symlinkSync(external, join(root, "annotations"));
    expect(() => annotationState(root, "default", target)).toThrow(/symlinks/);
    rmSync(join(root, "annotations"));
    const state = annotationState(root, "default", target);
    const bad = request(state); bad.document.properties["x-count"] = { type: "link", label: "Bad", value: { url: "javascript:alert(1)", purpose: "generic", label: "Bad" } };
    expect(() => saveAnnotation(root, bad)).toThrow(/http/);
    const saved = saveAnnotation(root, request(state));
    writeFileSync(join(root, "annotations/default/duplicate.json"), JSON.stringify(saved.document));
    expect(() => readAnnotations(root)).toThrow(/identity/);
  });
  it("isolates identical entity ids in separate catalog profiles", () => {
    const root = workspace(); const manifest = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    manifest.catalogs = ["first", "second"].map((id) => ({ id, title: id, sources: manifest.sources, contexts: ["shop"], projects: [] }));
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    saveAnnotation(root, request(annotationState(root, "first", target)));
    expect(annotationState(root, "second", target).fileRevision).toBeNull();
    expect(readAnnotations(root).map((a) => a.catalog)).toEqual(["first"]);
  });
});
