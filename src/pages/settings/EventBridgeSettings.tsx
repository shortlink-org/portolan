import { useEffect, useState } from "react";
import { Cloud, Copy, Plus, Save, Trash2, X } from "lucide-react";

import { activeCatalogProfile } from "../../data";
import { toClipboard } from "../../lib/clipboard";
import { eventBridgeSettings, saveEventBridge, subscribeToRun } from "../../lib/local-api";
import type { EventBridgeEntry, EventBridgeState, SaveEventBridge } from "../../lib/local-api";
import { useToastStore } from "../../app/toast";

const FIELD = "mono w-full min-w-0 rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent disabled:opacity-60";
type MappingRow = { id: number; identity: string; service: string };
type Draft = Omit<SaveEventBridge, "revision" | "generate" | "sources" | "targets"> & { sources: MappingRow[]; targets: MappingRow[] };
let rowId = 0;

const rows = (value: Record<string, string>): MappingRow[] => Object.entries(value).map(([identity, service]) => ({ id: ++rowId, identity, service }));
const record = (value: MappingRow[]): Record<string, string> => Object.fromEntries(value.map((item) => [item.identity.trim(), item.service.trim()]));
const list = (value: string): string[] => [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
const blank = (state: EventBridgeState): Draft => ({
  step: null,
  catalogs: state.catalogs.some((catalog) => catalog.id === activeCatalogProfile.id) ? [activeCatalogProfile.id] : state.catalogs.map((catalog) => catalog.id),
  regions: [],
  buses: [],
  sources: [],
  targets: [],
});
const fromEntry = (entry: EventBridgeEntry): Draft => ({
  step: entry.step,
  catalogs: [...entry.catalogs],
  regions: [...entry.regions],
  buses: [...entry.buses],
  sources: rows(entry.sources),
  targets: rows(entry.targets),
  ruleTags: entry.ruleTags ? { ...entry.ruleTags } : undefined,
});

function MappingFields({ label, description, value, disabled, onChange }: { label: string; description: string; value: MappingRow[]; disabled: boolean; onChange: (value: MappingRow[]) => void }) {
  const change = (id: number, patch: Partial<MappingRow>) => onChange(value.map((row) => row.id === id ? { ...row, ...patch } : row));
  return <fieldset className="rounded-control border border-line bg-surface p-4" disabled={disabled}>
    <legend className="px-1 font-medium">{label}</legend>
    <p className="mb-3 text-xs text-muted">{description}</p>
    <div className="space-y-2">
      {value.map((row) => <div key={row.id} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]">
        <input aria-label={`${label} identity`} className={FIELD} value={row.identity} placeholder={label === "Publishers" ? "com.acme.orders" : "lambda:invoice-handler"} onChange={(event) => change(row.id, { identity: event.target.value })} />
        <input aria-label={`${label} service`} className={FIELD} value={row.service} placeholder="shop.orders" onChange={(event) => change(row.id, { service: event.target.value })} />
        <button type="button" className="tbtn px-2" aria-label={`Remove ${label.toLowerCase()} mapping`} onClick={() => onChange(value.filter((item) => item.id !== row.id))}><Trash2 size={14} aria-hidden /></button>
      </div>)}
      {!value.length ? <p className="text-sm text-muted">No explicit mappings.</p> : null}
    </div>
    <button type="button" className="tbtn mt-3 px-2 py-1" onClick={() => onChange([...value, { id: ++rowId, identity: "", service: "" }])}><Plus size={13} aria-hidden />Add mapping</button>
  </fieldset>;
}

export function EventBridgeSettings({ local }: { local: boolean }) {
  const say = useToastStore((state) => state.say);
  const [state, setState] = useState<EventBridgeState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState("");

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    eventBridgeSettings().then((value) => { if (!cancelled) setState(value); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [local]);

  useEffect(() => {
    if (!runId) return;
    let finished = false;
    const close = subscribeToRun(runId, (event) => {
      if (event.type !== "process-finished") return;
      finished = true;
      setRunMessage(event.status === "ok" ? "Catalog and diagrams rebuilt. Reload to view the EventBridge topology." : `Generation ${event.status}. Open Build settings for the AWS or extraction error.`);
      setRunId(null);
    }, () => {
      if (!finished) { setRunMessage("Settings saved. The build connection was interrupted; check Build settings before retrying."); setRunId(null); }
    });
    return close;
  }, [runId]);

  let validation = "";
  if (draft) {
    if (!draft.regions.length) validation = "Add at least one AWS region.";
    else if (state?.catalogs.length && !draft.catalogs.length) validation = "Select at least one catalog.";
    else {
      const all = [...draft.sources, ...draft.targets];
      if (all.some((item) => !item.identity.trim() || !/^.+\..+$/.test(item.service.trim()))) validation = "Every mapping needs an identity and a context.service id.";
      else if (new Set(draft.sources.map((item) => item.identity.trim())).size !== draft.sources.length || new Set(draft.targets.map((item) => item.identity.trim())).size !== draft.targets.length) validation = "Mapping identities must be unique within each section.";
      else if (draft.ruleTags && Boolean(draft.ruleTags.context.trim()) !== Boolean(draft.ruleTags.service.trim())) validation = "Rule tag fallback needs both context and service tag keys.";
    }
  }

  const reload = async () => {
    if (!local) return;
    setBusy(true);
    try { setState(await eventBridgeSettings()); setDraft(null); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const save = async (generate: boolean) => {
    if (!state || !draft || validation) return;
    setBusy(true); setError("");
    try {
      const saved = await saveEventBridge({
        revision: state.revision,
        step: draft.step,
        catalogs: draft.catalogs,
        regions: draft.regions,
        buses: draft.buses,
        sources: record(draft.sources),
        targets: record(draft.targets),
        ...(draft.ruleTags?.context.trim() && draft.ruleTags.service.trim() ? { ruleTags: { context: draft.ruleTags.context.trim(), service: draft.ruleTags.service.trim() } } : {}),
        generate,
      });
      setState(saved); setDraft(null);
      setRunMessage(saved.generationError ? `Settings saved; generation could not start: ${saved.generationError}` : saved.run ? "Settings saved. Reading EventBridge and rebuilding the catalog…" : "Settings saved to portolan.json. Rebuild the catalog when you are ready to call AWS.");
      setRunId(saved.run?.runId ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    const config = draft ? {
      plugin: "eventbridge", in: ".", out: draft.step === null ? "portolan-eventbridge" : state?.entries.find((entry) => entry.step === draft.step)?.output ?? "portolan-eventbridge",
      options: { regions: draft.regions.length ? draft.regions : ["eu-west-1"], ...(draft.buses.length ? { buses: draft.buses } : {}), ...(draft.sources.length ? { sources: record(draft.sources) } : {}), ...(draft.targets.length ? { targets: record(draft.targets) } : {}), ...(draft.ruleTags?.context && draft.ruleTags.service ? { ruleTags: draft.ruleTags } : {}), cache: draft.step === null ? "portolan-eventbridge" : state?.entries.find((entry) => entry.step === draft.step)?.output ?? "portolan-eventbridge" },
    } : { plugin: "eventbridge", in: ".", out: "portolan-eventbridge", options: { regions: ["eu-west-1"], cache: "portolan-eventbridge" } };
    say(await toClipboard(JSON.stringify(config, null, 2)) ? "EventBridge configuration copied." : "Could not copy configuration.");
  };

  return <section className="min-w-0 rounded-card border border-line bg-canvas p-card shadow-xs lg:col-span-2">
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface"><Cloud size={18} aria-hidden /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">EventBridge control plane</h2><span className="chip text-muted">{local ? "project configuration" : "local project required"}</span></div><p className="mt-1 text-muted">Read deployed buses, enabled rules and targets through the AWS API. The form writes architectural scope and identity mappings to portolan.json.</p></div>
    </div>

    <div className="mt-4 rounded-control border border-line bg-surface p-4">
      <h3 className="font-medium">AWS authentication stays outside Portolan</h3>
      <p className="mt-1 text-sm text-muted">Use the standard AWS SDK credential chain: workload role, environment, shared credentials or <code>AWS_PROFILE</code>. This page never asks for or stores access keys, secrets, sessions or profiles.</p>
      <p className="mt-2 text-xs text-muted">Required read permissions: events:ListEventBuses, events:ListRules and events:ListTargetsByRule. Add events:ListTagsForResource only when rule-tag fallback is enabled.</p>
    </div>

    {!local ? <div className="mt-4 rounded-control border border-dashed border-line p-4"><p className="text-muted">Published catalogs cannot change portolan.json. Open this project with <code>portolan dev</code> to edit the plugin, or copy a starter step.</p><button type="button" className="tbtn mt-3 px-3 py-1.5" onClick={() => void copy()}><Copy size={14} aria-hidden />Copy starter step</button></div> : null}

    {local ? <>
      <div className="mt-4 space-y-2">
        {state?.entries.map((entry) => <div key={entry.step} className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface px-3 py-2">
          <Cloud size={15} className="shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1"><div className="font-medium">{entry.regions.join(", ")}</div><div className="mt-1 break-all text-xs text-muted">{entry.buses.length ? `${entry.buses.length} selected bus${entry.buses.length === 1 ? "" : "es"}` : "all visible buses"} · {entry.output}/eventbridge.json</div></div>
          <span className="chip text-muted">{entry.catalogs.length} catalog{entry.catalogs.length === 1 ? "" : "s"}</span>
          <button type="button" className="tbtn px-2 py-1" disabled={busy || !!runId || !!draft} onClick={() => { setDraft(fromEntry(entry)); setError(""); }}>Configure</button>
        </div>)}
        {!state && !error ? <p role="status" className="text-muted">Loading EventBridge configuration…</p> : null}
        {state && !state.entries.length && !draft ? <p className="rounded-control border border-dashed border-line p-4 text-muted">No EventBridge API scope configured yet.</p> : null}
      </div>
      {state && !draft ? <button type="button" className="tbtn mt-3 px-3 py-1.5" disabled={busy || !!runId} onClick={() => setDraft(blank(state))}><Plus size={14} aria-hidden />Add AWS scope</button> : null}
    </> : null}

    {draft && state ? <div className="mt-5 space-y-4 border-t border-line pt-4">
      <div className="flex items-center justify-between"><h3 className="font-medium">{draft.step === null ? "New AWS scope" : "EventBridge configuration"}</h3><button type="button" className="tbtn p-1" aria-label="Close EventBridge configuration" disabled={busy} onClick={() => setDraft(null)}><X size={16} aria-hidden /></button></div>
      <fieldset disabled={busy || !local} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0"><span className="label mb-1.5 block">AWS regions</span><textarea key={`regions-${draft.step}`} rows={3} className={`${FIELD} resize-y`} defaultValue={draft.regions.join("\n")} placeholder="eu-west-1\nus-east-1" onBlur={(event) => setDraft({ ...draft, regions: list(event.target.value) })} /><span className="mt-1 block text-xs text-muted">One per line or comma-separated. At least one is required.</span></label>
          <label className="min-w-0"><span className="label mb-1.5 block">Event buses</span><textarea key={`buses-${draft.step}`} rows={3} className={`${FIELD} resize-y`} defaultValue={draft.buses.join("\n")} placeholder="orders\narn:aws:events:…:event-bus/audit" onBlur={(event) => setDraft({ ...draft, buses: list(event.target.value) })} /><span className="mt-1 block text-xs text-muted">Names or ARNs. Empty means every bus this identity can list.</span></label>
        </div>
        <div><span className="label mb-2 block">Catalog scope</span><div className="flex flex-wrap gap-3">{state.catalogs.map((catalog) => <label key={catalog.id} className="inline-flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={draft.catalogs.includes(catalog.id)} onChange={(event) => setDraft({ ...draft, catalogs: event.target.checked ? [...draft.catalogs, catalog.id] : draft.catalogs.filter((id) => id !== catalog.id) })} />{catalog.title}</label>)}</div></div>
        <MappingFields label="Publishers" description="Map exact EventBridge source values to the service that calls PutEvents." value={draft.sources} disabled={busy || !local} onChange={(sources) => setDraft({ ...draft, sources })} />
        <MappingFields label="Consumers" description="Map a target ARN, target id, resource name or qualified identity to the receiving service." value={draft.targets} disabled={busy || !local} onChange={(targets) => setDraft({ ...draft, targets })} />
        <fieldset className="rounded-control border border-line bg-surface p-4"><legend className="px-1 font-medium">Rule-tag fallback</legend><p className="mb-3 text-xs text-muted">Optional. Use when both tags on a rule identify one consumer service for all of its targets.</p><div className="grid gap-3 sm:grid-cols-2"><label><span className="label mb-1.5 block">Context tag key</span><input className={FIELD} value={draft.ruleTags?.context ?? ""} placeholder="portolan.context" onChange={(event) => setDraft({ ...draft, ruleTags: { context: event.target.value, service: draft.ruleTags?.service ?? "" } })} /></label><label><span className="label mb-1.5 block">Service tag key</span><input className={FIELD} value={draft.ruleTags?.service ?? ""} placeholder="portolan.service" onChange={(event) => setDraft({ ...draft, ruleTags: { context: draft.ruleTags?.context ?? "", service: event.target.value } })} /></label></div></fieldset>
        <div className="rounded-control border border-line px-3 py-2 text-sm"><span className="label">Snapshot and cache</span><p className="mt-1 text-muted">{draft.step === null ? "portolan-eventbridge" : state.entries.find((entry) => entry.step === draft.step)?.output}/eventbridge.json. The cache path is kept equal to the extractor output so CI can replay a digest-checked snapshot.</p></div>
      </fieldset>
      {validation ? <p role="alert" className="text-sm text-unresolved">{validation}</p> : null}
      <div className="flex flex-wrap gap-2"><button type="button" className="tbtn px-3 py-1.5" onClick={() => void copy()}><Copy size={14} aria-hidden />Copy step</button>{local ? <><button type="button" className="tbtn px-3 py-1.5" disabled={busy || !!validation || !!runId} onClick={() => void save(false)}><Save size={14} aria-hidden />Save</button><button type="button" className="product-primary" disabled={busy || !!validation || !!runId} onClick={() => void save(true)}><Cloud size={14} aria-hidden />Save and read AWS</button></> : null}</div>
    </div> : null}
    {runMessage ? <p role="status" className="mt-4 text-sm text-muted">{runMessage}</p> : null}
    {error ? <div role="alert" className="mt-4 text-sm text-unresolved"><p className="break-words">{error}</p>{local ? <button type="button" className="tbtn mt-2 px-2 py-1" disabled={busy} onClick={() => void reload()}>Reload settings</button> : null}</div> : null}
  </section>;
}
