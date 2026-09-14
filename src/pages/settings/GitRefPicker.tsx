import { useEffect, useId, useRef, useState } from "react";
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import { Check, ChevronDown, GitBranch, RefreshCw, Tag } from "lucide-react";
import { gitRepositoryRefs, type GitRefsResult } from "../../lib/local-api";

/** Keyed by repository so a response can never leak into another URL's draft. */
export function GitRefPicker(props: { repository: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <RepositoryRefPicker key={props.repository} {...props} />;
}

function RepositoryRefPicker({ repository, value, onChange, disabled }: { repository: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const [result, setResult] = useState<GitRefsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const alive = useRef(true);
  const inFlight = useRef(false);
  const attempted = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async (refresh = false) => {
    if (disabled || !repository.trim() || inFlight.current || (attempted.current && !refresh)) return;
    attempted.current = true; inFlight.current = true; setLoading(true); setError("");
    try { const next = await gitRepositoryRefs(repository); if (alive.current) setResult(next); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Could not load revisions. Enter a ref manually."); }
    finally { inFlight.current = false; if (alive.current) setLoading(false); }
  };
  const matches = (result?.refs ?? []).filter((item) => item.ref.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = matches.slice(0, 100);
  const status = loading ? "Loading branches and tags…" : error || (result ? `${result.refs.length} revisions loaded${result.truncated ? " · Partial list" : ""}` : "Open to load branches and tags.");
  return <div className="min-w-0">
    <label htmlFor={id} className="label mb-1.5 block">Branch or tag</label>
    <Combobox value={value} onChange={(next: string | null) => { if (next !== null) { onChange(next); setQuery(""); } }} disabled={disabled} immediate onClose={() => setQuery("")}>
      <div className="flex min-w-0 gap-1.5">
        <div className="relative min-w-0 flex-1">
          <ComboboxInput id={id} aria-describedby={`${id}-hint`} className="mono w-full min-w-0 rounded-control border border-line bg-canvas py-2 pl-3 pr-9 text-ink outline-none focus:border-accent disabled:opacity-60" displayValue={(ref: string) => ref} placeholder="Remote HEAD (default)" spellCheck={false} onFocus={() => void load()} onChange={(event) => { setQuery(event.target.value); onChange(event.target.value); void load(); }} />
          <ComboboxButton aria-label="Browse branches and tags" className="tbtn absolute inset-y-1 right-1 px-1.5" onClick={() => void load()}><ChevronDown size={14} aria-hidden /></ComboboxButton>
        </div>
        <button type="button" className="tbtn px-2" aria-label="Refresh branches and tags" title="Refresh branches and tags" disabled={disabled || loading || !repository.trim()} onClick={() => void load(true)}><RefreshCw size={14} aria-hidden className={loading ? "animate-spin motion-reduce:animate-none" : ""} /></button>
      </div>
      <ComboboxOptions aria-label="Branches and tags" anchor={{ to: "bottom start", gap: 4, padding: 8 }} className="palette-in z-50 max-h-72 overflow-y-auto rounded-card border border-line-strong bg-canvas p-1.5 shadow-md focus:outline-none" style={{ width: "max(var(--input-width), 240px)", maxWidth: "calc(100vw - 1rem)" }}>
        <ComboboxOption value={value} className="cursor-pointer rounded-control px-2.5 py-2 text-sm text-muted data-focus:bg-raised">
          <span className="block break-all">{value ? `Use “${value}”` : "Remote HEAD"}</span><span className="block text-xs">{value ? "Keep entered ref" : "Use the repository’s default branch"}</span>
        </ComboboxOption>
        {(["branch", "tag"] as const).map((kind) => {
          const items = visible.filter((item) => item.kind === kind);
          const Icon = kind === "branch" ? GitBranch : Tag;
          return items.length ? <div key={kind} role="group" aria-label={kind === "branch" ? "Branches" : "Tags"}>
            <div className="label flex items-center gap-1.5 px-2.5 pb-1 pt-3 text-muted"><Icon size={12} aria-hidden />{kind === "branch" ? "Branches" : "Tags"}</div>
            {items.map((item) => <ComboboxOption key={item.ref} value={item.ref} className="mono flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-sm text-ink data-focus:bg-raised">
              {({ selected }) => <><Check size={13} aria-hidden className={`shrink-0 text-accent ${selected ? "" : "invisible"}`} /><span className="min-w-0 break-all">{item.name}</span></>}
            </ComboboxOption>)}
          </div> : null;
        })}
        <p className="px-2.5 py-2 text-xs text-muted">{loading ? "Loading…" : !matches.length ? "No matching revisions. You can enter a ref manually." : matches.length > visible.length ? "Showing the first 100 matches. Type to narrow the list." : "Type to search or enter a ref manually."}</p>
      </ComboboxOptions>
    </Combobox>
    <p id={`${id}-hint`} role="status" className={`mt-1 text-xs ${error ? "text-unresolved" : "text-muted"}`}>{status}</p>
    {result?.truncated ? <p className="mt-1 text-xs text-muted">Some revisions are omitted. You can still enter a supported ref manually.</p> : null}
  </div>;
}
