import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown, FileCode2 } from "lucide-react";
import type { Catalog, Flow } from "../catalog";
import type { SourceLocation } from "../lib/source-link";
import { relatedWorkItems } from "../lib/work-items";
import { EditorLink } from "../components/EditorLink";
import { FlowTrigger } from "../components/FlowTrigger";
import { Ident } from "../components/Ident";
import { SourcePreviewButton } from "../components/SourcePreview";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { WorkItems } from "../components/WorkItems";
import { RecordingsChip } from "./Recordings";

/** Task context stays visible; source tools and recordings open as one section. */
export function FlowEvidence({ catalog, flow, source, exampleId, onExample }: {
  catalog: Catalog;
  flow: Flow;
  source: SourceLocation | null;
  exampleId: string | null;
  onExample: (id: string | null) => void;
}) {
  const target = { kind: "flow" as const, id: flow.id };
  const tasks = relatedWorkItems(catalog, target);
  const recordings = flow.examples?.length ?? 0;
  return <section aria-label="Flow context" className="mt-2 min-w-0 rounded-control border border-line bg-surface">
    {tasks.length ? <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-canvas px-2.5 py-1.5 rounded-t-control">
      <span className="label shrink-0 text-faint">Tasks <span className="ml-1 font-mono">{tasks.length}</span></span>
      <WorkItems catalog={catalog} target={target} variant="summary" />
    </div> : null}
    <Disclosure>
      {({ open }) => <>
        <DisclosureButton className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control px-2.5 py-2 text-left text-xs text-muted hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label="Flow evidence details">
          <span className="label shrink-0">Evidence</span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <FileCode2 size={13} className="shrink-0 text-faint" aria-hidden />
            <span className="truncate font-mono" title={flow.source}>{flow.source || "No source file"}</span>
          </span>
          {flow.trigger ? <FlowTrigger trigger={flow.trigger} /> : null}
          <span className={`shrink-0 ${exampleId ? "text-accent" : "text-faint"}`}>{recordings ? `${recordings} ${recordings === 1 ? "recording" : "recordings"}${exampleId ? " · selected" : ""}` : "No recordings"}</span>
          <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </DisclosureButton>
        <DisclosurePanel unmount={false} className="border-t border-line px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
            <div className="min-w-0">
              <div className="label mb-1.5 text-faint">Source</div>
              {flow.source ? <Ident value={flow.source} className="max-w-full break-all text-muted" /> : <p className="text-xs text-muted">No source file recorded for this flow.</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <SourcePreviewButton location={source} />
                {source?.href ? <a href={source.href} target="_blank" rel="noreferrer" className="text-accent hover:underline" title="Open the source on the forge, at the built commit">open on forge ↗</a> : null}
                <EditorLink location={source} variant="text" />
              </div>
              {flow.includes?.length ? <details className="mt-2 text-xs text-muted">
                <summary className="cursor-pointer">Composed from {flow.includes.length + 1} fragments</summary>
                <ul className="mt-1 space-y-1 break-words">
                  {flow.composition?.length ? flow.composition.map((item) => <li key={`${item.flow}:${item.seam.afterStep}`}>{item.flow} · after {item.seam.afterStep} · {item.seam.kind} · {item.seam.target} · {item.seam.confidence}</li>) : flow.includes.map((slug) => <li key={slug}>{slug}</li>)}
                </ul>
              </details> : null}
            </div>
            <div className="min-w-0">
              <div className="label mb-1.5 text-faint">Recordings & links</div>
              <div className="flex flex-wrap items-center gap-2">
                <RecordingsChip flow={flow} exampleId={exampleId} onExample={onExample} />
                <WhatLinksHere target={{ kind: "flow", id: flow.slug }} variant="line" className="mt-0" />
              </div>
              {!recordings ? <p className="mt-2 text-xs text-faint">No recorded runs attached.</p> : null}
            </div>
          </div>
        </DisclosurePanel>
      </>}
    </Disclosure>
  </section>;
}
