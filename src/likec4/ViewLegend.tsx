// The key to a C4 picture, opened from the toolbar that floats over it.
//
// Closed by default: the picture is the answer and the key is how to read it,
// so it waits one click away rather than covering the graph. It lives inside
// the fullscreen box, because a drawing given the whole screen still needs one.

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { statusColor, statusDash } from "../graph/theme";
import type { ArrowEntry, BoxEntry, EvidenceEntry, Head, Legend } from "./legend";

const W = 32;
const H = 18;

function boxColor(entry: BoxEntry, context: number): string {
  if (entry.tone === "context") return `var(--ctx-${context})`;
  if (entry.tone === "unresolved") return "var(--status-unresolved)";
  if (entry.tone === "accent") return "var(--accent)";
  return "var(--fg-muted)";
}

function BoxMark({ entry, context }: { entry: BoxEntry; context: number }) {
  const color = boxColor(entry, context);
  const fill = `color-mix(in srgb, ${color} ${entry.frame ? 6 : 18}%, transparent)`;
  const stroke = { stroke: color, strokeWidth: 1.25, fill, strokeDasharray: entry.dashed ? "3 2" : undefined };
  switch (entry.shape) {
    case "storage":
      return (
        <>
          <path d="M9 4 v10 a7 2.5 0 0 0 14 0 v-10" {...stroke} />
          <ellipse cx={16} cy={4} rx={7} ry={2.5} {...stroke} />
        </>
      );
    case "queue":
      return (
        <>
          <path d="M8 3 h16 a2.5 6 0 0 1 0 12 h-16 a2.5 6 0 0 1 0 -12 z" {...stroke} />
          <ellipse cx={24} cy={9} rx={2.5} ry={6} {...stroke} />
        </>
      );
    case "person":
      return (
        <>
          <circle cx={16} cy={5} r={3.5} {...stroke} />
          <path d="M9 17 v-3 a4 4 0 0 1 4 -4 h6 a4 4 0 0 1 4 4 v3 z" {...stroke} />
        </>
      );
    default:
      return <rect x={5} y={3} width={22} height={12} rx={2} {...stroke} />;
  }
}

function ArrowMark({ head, color, dash }: { head: Head; color: string; dash?: string }) {
  const end = head === "none" ? W - 3 : W - 9;
  return (
    <>
      <line x1={3} y1={H / 2} x2={end} y2={H / 2} stroke={color} strokeWidth={1.5} strokeDasharray={dash} />
      {head === "none" ? null : (
        <path
          d={`M${W - 9} ${H / 2 - 4} L${W - 3} ${H / 2} L${W - 9} ${H / 2 + 4} z`}
          stroke={color}
          strokeWidth={1.25}
          strokeLinejoin="round"
          fill={head === "normal" ? color : "var(--bg)"}
        />
      )}
    </>
  );
}

function Row({ mark, name, note }: { mark: ReactNode; name: string; note: string }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] items-start gap-x-3 py-1">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="mt-0.5 overflow-visible">
        {mark}
      </svg>
      <div className="min-w-0">
        <span className="text-sm text-ink">{name}</span>{" "}
        <span className="text-sm text-muted">{note}</span>
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-card py-2 first:border-t-0">
      <h3 className="label">{title}</h3>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

function evidenceMark(entry: EvidenceEntry) {
  if (entry.status === "mixed") return <ArrowMark head="normal" color="var(--fg-muted)" dash="5 3" />;
  return <ArrowMark head="normal" color={statusColor(entry.status)} dash={statusDash(entry.status)} />;
}

function arrowMark(entry: ArrowEntry) {
  // Colour and line belong to the evidence section; here only the head speaks.
  return <ArrowMark head={entry.head} color={entry.muted ? "var(--fg-muted)" : "var(--fg)"} />;
}

export function LegendButton({ open, controls, onToggle }: { open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      className={open ? "is-on" : ""}
      onClick={onToggle}
      onKeyDown={(event) => { if (open && event.key === "Escape") { event.stopPropagation(); onToggle(); } }}
    >
      Legend
    </button>
  );
}

export function LegendPanel({ id, legend, onClose }: { id: string; legend: Legend; onClose: () => void }) {
  const first = legend.contexts[0] ?? 0;
  return (
    <div
      id={id}
      role="region"
      aria-label="Diagram legend"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      className="absolute top-12 right-3 z-10 max-h-[calc(100%-4rem)] w-[22rem] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-card border border-line bg-canvas shadow-md"
    >
      <div className="flex items-center justify-between gap-3 px-card pt-3 pb-1">
        <span className="text-sm font-semibold text-ink">How to read this diagram</span>
        <button type="button" className="tbtn shrink-0" aria-label="Close legend" onClick={onClose}>
          <X size={13} aria-hidden />
        </button>
      </div>
      {legend.boxes.length ? (
        <Section title="Boxes">
          {legend.boxes.map((entry) => (
            <Row key={entry.kind} mark={<BoxMark entry={entry} context={first} />} name={entry.name} note={entry.note} />
          ))}
        </Section>
      ) : null}
      {legend.contexts.length ? (
        <Section title="Colours">
          <li className="grid grid-cols-[2rem_1fr] items-start gap-x-3 py-1">
            <span className="mt-1 flex flex-wrap gap-0.5" aria-hidden>
              {legend.contexts.map((index) => (
                <span key={index} className="h-2 w-2 rounded-full" style={{ background: `var(--ctx-${index})` }} />
              ))}
            </span>
            <span className="text-sm text-muted">
              Each colour names a bounded context and ranks nothing. Six colours repeat, so the name on the boundary decides.
              Grey boxes carry no context colour: stores, brokers, infrastructure and anything outside the estate.
            </span>
          </li>
        </Section>
      ) : null}
      {legend.arrows.length ? (
        <Section title="Arrows">
          {legend.arrows.map((entry) => (
            <Row key={entry.key} mark={arrowMark(entry)} name={entry.name} note={entry.note} />
          ))}
        </Section>
      ) : null}
      {legend.evidence.length ? (
        <Section title="Evidence">
          {legend.evidence.map((entry) => (
            <Row key={entry.status} mark={evidenceMark(entry)} name={entry.name} note={entry.note} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/** Button and panel wired together, for a toolbar that has room for both. */
export function useLegend() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return { id, open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}
