import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChartNoAxesCombined, Copy, ExternalLink, FileText, FolderGit2, Link as LinkIcon, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnnotationTarget, CatalogAnnotation, CustomProperty } from "../catalog";
import { activeCatalogProfile, catalog } from "../data";
import { annotationTargetKey, LINK_PURPOSES, PROPERTY_TYPES, safePropertyUrl } from "../lib/annotations.mjs";
import { toClipboard } from "../lib/clipboard";
import { getAnnotation, LocalApiError, saveAnnotation, startGeneration, subscribeToRun } from "../lib/local-api";
import type { AnnotationState } from "../lib/local-api";
import { draftProperty, editPropertyDocument, propertyDraft } from "../lib/property-editor";
import type { PropertyDraft } from "../lib/property-editor";
import { localStatusQuery } from "../lib/queries";
import { Ident } from "./Ident";
import { SidePanel } from "./Overlay";
import { SectionTitle } from "./PageHeader";

const purposeIcons = { runbook: BookOpen, dashboard: ChartNoAxesCombined, documentation: FileText, repository: FolderGit2, generic: LinkIcon };
const typeLabels = { link: "Link", text: "Text", number: "Number", boolean: "Yes / No", tags: "Tags", json: "Object / array" };

function CopyValue({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  return <span className="inline-flex items-center gap-2"><button type="button" className="tbtn" aria-label={`Copy ${label}`} onClick={async () => setMessage(await toClipboard(value) ? "Copied" : "Could not copy")}><Copy size={13} aria-hidden /><span className="sr-only">Copy</span></button><span role="status" className="text-xs text-muted">{message}</span></span>;
}

export function PropertyValue({ property }: { property: CustomProperty }) {
  switch (property.type) {
    case "link": {
      const Icon = purposeIcons[property.value.purpose] ?? LinkIcon;
      if (!safePropertyUrl(property.value.url)) return <span className="text-unresolved">Invalid link</span>;
      return <div className="flex min-w-0 items-start gap-3"><Icon size={18} className="mt-1 shrink-0 text-muted" aria-hidden /><div className="min-w-0"><a className="inline-flex items-center gap-1 break-anywhere text-accent hover:underline" href={property.value.url} target="_blank" rel="noopener noreferrer">{property.value.label}<ExternalLink size={13} className="shrink-0" aria-hidden /></a><div className="mt-1 break-anywhere text-xs text-muted">{new URL(property.value.url).host}</div></div></div>;
    }
    case "boolean": return <span>{property.value ? "Yes" : "No"}</span>;
    case "number": return <span className="tnum">{property.value}{property.unit ? ` ${property.unit}` : ""}</span>;
    case "tags": return property.value.length ? <div className="flex flex-wrap gap-1">{property.value.map((tag, i) => <span className="chip" key={`${i}:${tag}`}>{tag}</span>)}</div> : <span className="text-muted">Empty list</span>;
    case "json": return <details><summary className="text-accent">{Array.isArray(property.value) ? `Array · ${property.value.length} items` : `Object · ${Object.keys(property.value).length} fields`}</summary><pre className="property-json mt-2">{JSON.stringify(property.value, null, 2)}</pre><CopyValue value={JSON.stringify(property.value, null, 2)} label="JSON value" /></details>;
    case "text": return <span className="whitespace-pre-wrap break-anywhere">{property.value === "" ? <span className="text-muted">Empty text</span> : property.value}</span>;
    default: return <pre className="property-json">{JSON.stringify(property, null, 2)}</pre>;
  }
}

type Selection = { key: string | null; type: CustomProperty["type"] };
export function CustomPropertiesContent({ annotation, onEdit }: { annotation?: CatalogAnnotation; onEdit?: (selection: Selection) => void }) {
  const entries = (annotation?.order ?? []).map((key) => ({ key, property: annotation!.properties[key]! }));
  const links = entries.filter(({ property }) => property.type === "link");
  const values = entries.filter(({ property }) => property.type !== "link");
  if (!entries.length) return onEdit ? <div className="mb-section"><button type="button" className="tbtn" onClick={() => onEdit({ key: null, type: "link" })}><Plus size={14} aria-hidden />Add resources or properties</button></div> : null;
  const groups = [...new Set(values.map(({ property }) => property.group ?? ""))];
  const add = (type: CustomProperty["type"], label: string) => onEdit && <button type="button" className="tbtn" onClick={() => onEdit({ key: null, type })}><Plus size={13} aria-hidden />{label}</button>;
  return <section className="mb-section" aria-label="Custom properties">
    {(links.length > 0 || onEdit) && <div className="mb-5"><SectionTitle right={add("link", "Add resource")}>Resources</SectionTitle><div>{links.map(({ key, property }) => <div className="property-resource" key={key}><div className="min-w-0 flex-1"><PropertyValue property={property} /><div className="mt-1 text-xs text-muted">{property.label}{property.group ? ` · ${property.group}` : ""}</div></div><div className="flex shrink-0 flex-wrap items-center gap-2"><CopyValue value={(property as Extract<CustomProperty, { type: "link" }>).value.url} label={`${property.label} URL`} />{onEdit && <button type="button" className="tbtn" aria-label={`Edit ${property.label}`} onClick={() => onEdit({ key, type: property.type })}>Edit</button>}</div></div>)}</div></div>}
    {(values.length > 0 || onEdit) && <div><SectionTitle right={add("text", "Add property")}>Properties</SectionTitle>{groups.map((group) => <div key={group}>{group && <h3 className="mt-4 mb-1 text-sm font-medium">{group}</h3>}<dl>{values.filter(({ property }) => (property.group ?? "") === group).map(({ key, property }) => <div className="property-row" key={key}><dt className="text-muted">{property.label}</dt><dd className="min-w-0"><PropertyValue property={property} /></dd>{onEdit && <button type="button" className="tbtn self-start" aria-label={`Edit ${property.label}`} onClick={() => onEdit({ key, type: property.type })}>Edit</button>}</div>)}</dl></div>)}</div>}
    <details className="mt-3 text-xs"><summary className="text-muted">Source · <span className="text-declared">declared</span></summary><div className="mt-2"><Ident value={annotation!.source} /></div><pre className="property-json mt-2">{JSON.stringify({ properties: annotation!.properties, order: annotation!.order }, null, 2)}</pre></details>
  </section>;
}

export function CustomProperties({ target }: { target: AnnotationTarget }) {
  const status = useQuery({ ...localStatusQuery(), enabled: import.meta.env.DEV, retry: false });
  const local = status.data?.local === true;
  const state = useQuery({ queryKey: ["local", "annotations", activeCatalogProfile.id, target.kind, target.id], queryFn: () => getAnnotation(activeCatalogProfile.id, target), enabled: local, retry: false });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingBuild, setPendingBuild] = useState(false);
  const annotation = catalog.annotations?.find((entry) => entry.catalog === activeCatalogProfile.id && annotationTargetKey(entry.target) === annotationTargetKey(target));
  return <>
    <CustomPropertiesContent annotation={annotation} onEdit={state.data?.writable && !pendingBuild ? (next) => { setSelection(next); setEditorOpen(true); } : undefined} />
    {local && state.error && <div className="mb-section text-sm text-unresolved" role="alert">Properties editor unavailable: {state.error.message} <button className="tbtn" onClick={() => void state.refetch()}>Retry</button></div>}
    {pendingBuild && !editorOpen && <div className="mb-section flex flex-wrap items-center gap-3 text-sm text-declared" role="status">Properties are saved; the catalog update is pending.<button type="button" className="tbtn" onClick={() => setEditorOpen(true)}>Rebuild status</button></div>}
    {selection && state.data && <PropertyEditor key={`${target.kind}:${target.id}:${selection.key}`} open={editorOpen} initial={state.data} selection={selection} onSaved={() => setPendingBuild(true)} onClose={(saved) => { setEditorOpen(false); if (!saved) setSelection(null); }} />}
  </>;
}

function PropertyEditor({ open, initial, selection, onSaved, onClose }: { open: boolean; initial: AnnotationState; selection: Selection; onSaved: () => void; onClose: (saved: boolean) => void }) {
  const storageKey = `portolan:property-draft:${initial.workspace}:${initial.catalog}:${annotationTargetKey(initial.target)}:${selection.key ?? "new"}`;
  const [restored] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { base: AnnotationState; draft: PropertyDraft; remove?: boolean } | null;
      if (value && value.base?.workspace === initial.workspace && value.base.catalog === initial.catalog && annotationTargetKey(value.base.target) === annotationTargetKey(initial.target) && PROPERTY_TYPES.includes(value.draft?.type)) return value;
    } catch { /* The editor remains usable when browser storage is unavailable. */ }
    return null;
  });
  const [base, setBase] = useState(restored?.base ?? initial);
  const original = propertyDraft(selection.key, base.document.properties[selection.key ?? ""], selection.type);
  const [draft, setDraft] = useState(restored?.draft ?? original);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [progress, setProgress] = useState("");
  const [written, setWritten] = useState(false);
  const [disk, setDisk] = useState<AnnotationState | null>(restored && (restored.base.revision !== initial.revision || restored.base.fileRevision !== initial.fileRevision) ? initial : null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [remove, setRemove] = useState(restored?.remove ?? false);
  const stop = useRef<(() => void) | null>(null);
  const allowLeave = useRef(false);
  const dirty = !written && (remove || JSON.stringify(draft) !== JSON.stringify(original));
  let preview: CustomProperty | null = null, validation = "";
  try { preview = draftProperty(draft); if (!written) editPropertyDocument(base.document, draft, selection.key, remove); } catch (cause) { validation = cause instanceof Error ? cause.message : String(cause); }
  useEffect(() => {
    if (written) return;
    try { if (dirty) localStorage.setItem(storageKey, JSON.stringify({ base, draft, remove })); else localStorage.removeItem(storageKey); } catch { /* Optional draft recovery. */ }
  }, [base, draft, remove, dirty, written, storageKey]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (!allowLeave.current && (dirty || busy)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, busy]);
  useEffect(() => () => stop.current?.(), []);
  function patch(change: Partial<PropertyDraft>) { setDraft((current) => ({ ...current, ...change })); setFailure(""); }
  function discard() { try { localStorage.removeItem(storageKey); } catch {} onClose(false); }
  function close() { if (busy) return; if (dirty) setConfirmDiscard(true); else onClose(written); }
  function watch(runId: string) {
    setBusy(true); setProgress("Saved; rebuilding catalog…"); stop.current?.();
    let finished = false;
    stop.current = subscribeToRun(runId, (event) => {
      if (event.type === "step-started") setProgress(`Saved; rebuilding ${event.plugin}…`);
      if (event.type !== "process-finished") return;
      finished = true; stop.current?.(); stop.current = null; setBusy(false);
      if (event.status === "ok") {
        allowLeave.current = true;
        setProgress("Catalog updated");
        const url = new URL(window.location.href); url.searchParams.set("saved", String(Date.now()));
        // Defer navigation to let the unload guard observe the saved state.
        setTimeout(() => window.location.assign(url.href), 0);
      } else { setProgress(""); setFailure(`Properties are saved in ${base.path}, but catalog generation ${event.status}.`); }
    }, () => {
      if (finished) return;
      setBusy(false); setProgress(""); setFailure(`Properties are saved in ${base.path}, but the rebuild connection closed before completion.`);
    });
  }
  async function save() {
    setBusy(true); setFailure(""); setProgress("Saving properties…");
    try {
      const document = editPropertyDocument(base.document, draft, selection.key, remove);
      const saved = await saveAnnotation({ revision: base.revision, fileRevision: base.fileRevision, document });
      setWritten(true); onSaved(); setBase(saved); try { localStorage.removeItem(storageKey); } catch {}
      if (saved.run) watch(saved.run.runId);
      else { setBusy(false); setProgress(""); setFailure(`Properties are saved, but catalog generation did not start: ${saved.generationError ?? "unknown error"}`); }
    } catch (cause) {
      setBusy(false); setProgress(""); setFailure(cause instanceof Error ? cause.message : String(cause));
      if (cause instanceof LocalApiError && cause.status === 409) {
        try { setDisk(await getAnnotation(base.catalog, base.target)); } catch { /* Keep the original failure and draft. */ }
      }
    }
  }
  async function retry() { setBusy(true); setFailure(""); try { const run = await startGeneration("write"); watch(run.runId); } catch (cause) { setBusy(false); setFailure(cause instanceof Error ? cause.message : String(cause)); } }
  return <SidePanel open={open} onClose={close} side="right" label={selection.key ? "Edit property" : "Add property"} width="min(560px,100vw)"><form className="flex h-full flex-col border-l border-line bg-canvas" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <header className="flex items-center justify-between gap-3 border-b border-line p-4"><div><h2 className="text-lg font-semibold">{selection.key ? "Edit property" : "Add property"}</h2><div className="mt-1 text-xs text-muted">{base.target.id} · {written ? "saved" : dirty ? "unsaved draft" : "local authoring"}</div></div><button type="button" className="tbtn" aria-label="Close property editor" disabled={busy} onClick={close}><X size={16} aria-hidden /></button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
      {confirmDiscard && <div className="mb-4 rounded-control border border-line p-3" role="alert"><p>Discard unsaved property changes?</p><div className="mt-3 flex gap-2"><button type="button" className="tbtn" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" className="product-danger" onClick={discard}>Discard changes</button></div></div>}
      {disk && <div className="mb-4 rounded-control border border-line p-3"><p className="text-declared">The disk version changed. Your draft is preserved.</p><details className="mt-2"><summary>Compare disk and draft</summary><div className="mt-2 text-xs text-muted">Disk</div><pre className="property-json">{JSON.stringify(disk.document.properties[selection.key ?? draft.key] ?? null, null, 2)}</pre><div className="text-xs text-muted">Draft</div><pre className="property-json">{JSON.stringify(preview ?? draft, null, 2)}</pre></details><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="tbtn" onClick={() => { setBase(disk); setDraft(propertyDraft(selection.key, disk.document.properties[selection.key ?? ""], selection.type)); setDisk(null); setFailure(""); }}>Use disk version</button><button type="button" className="tbtn" onClick={() => { setBase(disk); setDisk(null); setFailure(""); }}>Keep draft against this version</button></div></div>}
      <fieldset disabled={busy || written} className="grid min-w-0 gap-4">
        <label className="property-field">Type<select value={draft.type} onChange={(event) => patch({ type: event.target.value as CustomProperty["type"] })}>{PROPERTY_TYPES.map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}</select></label>
        <label className="property-field">Property key<input required value={draft.key} pattern="x-[a-z0-9][a-z0-9-]{0,98}" maxLength={101} onChange={(event) => patch({ key: event.target.value })} /><span className="text-xs text-muted">Stable key beginning with x-.</span></label>
        <label className="property-field">Label<input required value={draft.label} maxLength={200} onChange={(event) => patch({ label: event.target.value })} /></label>
        <label className="property-field">Group (optional)<input value={draft.group} maxLength={100} placeholder="Operations" onChange={(event) => patch({ group: event.target.value })} /></label>
        {draft.type === "boolean" ? <label className="flex items-center gap-2"><input type="checkbox" checked={draft.checked} onChange={(event) => patch({ checked: event.target.checked })} />Yes</label> : <label className="property-field">{draft.type === "link" ? "Link title" : draft.type === "tags" ? "Tags, separated by commas" : draft.type === "json" ? "JSON value" : "Value"}{draft.type === "number" ? <input type="number" step="any" required value={draft.value} onChange={(event) => patch({ value: event.target.value })} /> : <textarea rows={draft.type === "json" ? 6 : 2} value={draft.value} maxLength={20000} onChange={(event) => patch({ value: event.target.value })} />}</label>}
        {draft.type === "number" && <label className="property-field">Unit (optional)<input value={draft.unit} maxLength={40} placeholder="min" onChange={(event) => patch({ unit: event.target.value })} /></label>}
        {draft.type === "link" && <><label className="property-field">URL<input required type="url" value={draft.url} placeholder="https://" maxLength={4096} onChange={(event) => patch({ url: event.target.value })} /></label><label className="property-field">Purpose<select value={draft.purpose} onChange={(event) => patch({ purpose: event.target.value as PropertyDraft["purpose"] })}>{LINK_PURPOSES.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}</select></label></>}
      </fieldset>
      <section className="mt-5 rounded-control border border-line bg-surface p-4" aria-label="Property preview"><h3 className="mb-3 text-sm font-medium">{remove ? "Property will be removed" : "Preview"}</h3>{!remove && (preview ? <PropertyValue property={preview} /> : <p className="text-sm text-muted">{validation}</p>)}</section>
      {validation && preview && !remove && <p className="mt-3 text-sm text-unresolved">{validation}</p>}
      <div className="mt-4 text-xs text-muted">Save destination <Ident value={base.path} /></div>
      {selection.key && !written && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={remove} onChange={(event) => setRemove(event.target.checked)} />Remove this property on save</label>}
    </div>
    <footer className="border-t border-line p-4">{failure && <div className="mb-3 text-sm text-unresolved" role="alert">{failure}</div>}<div role="status" className="mb-2 text-sm text-muted">{progress}</div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="tbtn" disabled={busy} onClick={() => dirty ? setConfirmDiscard(true) : onClose(written)}>{written ? "Close" : "Discard"}</button>{written ? <button type="button" className="product-primary" disabled={busy} onClick={() => void retry()}>Retry rebuild</button> : <button type="submit" className="product-primary" disabled={busy || !!disk || !!validation && !remove || !dirty}>{busy ? "Saving…" : remove ? "Remove & rebuild" : "Save & rebuild"}</button>}</div></footer>
  </form></SidePanel>;
}
