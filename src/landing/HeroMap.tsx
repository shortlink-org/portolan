// The hero's picture: the example estate's context map, drawn by the same
// component that draws it on the map page, with elk placing the domains and
// one line per relationship.
//
// It tours itself until the reader takes over. Every few seconds the next
// domain is selected - which lights its lines and dims the rest, exactly as a
// click would - and a card names it. A pointer over the map pauses the tour;
// a click ends it, because from then on the selection is the reader's.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Boxes } from "lucide-react";
import { catalog } from "../data";
import { contextVar } from "../lib/context-color";
import { contextMap } from "../lib/context-map";
import { contextStats } from "../lib/derive";
import { AnimatePresence, m, rise, useReducedMotion } from "../lib/motion";
import { ContextMapPane } from "../map/ContextMapGraph";
import { paths } from "../routes";
import { useSelectionStore } from "../selection/store";
import { catalogTo, useSelectionCleared } from "./catalog";

const FIRST_MS = 1400;
const EVERY_MS = 2800;

export function HeroMap() {
  const relations = useMemo(() => contextMap(catalog), []);
  const selectionId = useSelectionStore((s) => s.selection?.id ?? null);
  const select = useSelectionStore((s) => s.select);
  const reduced = useReducedMotion();
  const [touched, setTouched] = useState(false);
  const [hovering, setHovering] = useState(false);
  const at = useRef(0);
  useSelectionCleared();

  useEffect(() => {
    if (touched || hovering || reduced) return;
    const ids = catalog.contexts.map((c) => c.id);
    if (ids.length === 0) return;
    const tick = () => {
      select(ids[at.current % ids.length]!, "diagram");
      at.current += 1;
    };
    let every = 0;
    const first = window.setTimeout(() => {
      tick();
      every = window.setInterval(tick, EVERY_MS);
    }, FIRST_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [touched, hovering, reduced, select]);

  const context = catalog.contexts.find((c) => c.id === selectionId) ?? null;
  const stats = context ? contextStats(context) : null;

  return (
    <div
      className="landing-canvas relative h-[440px]"
      onPointerDown={() => setTouched(true)}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {/* The map stops above the strip, so the strip never covers a domain;
          the frame's dotted ground runs on beneath both. */}
      <div className="absolute inset-x-0 top-0 bottom-[68px]">
        <ContextMapPane
          catalog={catalog}
          relations={relations}
          zoomOnScroll={false}
        />
      </div>
      <AnimatePresence mode="wait">
        {context && stats ? (
          <m.div
            key={context.id}
            {...rise}
            className="pointer-events-none absolute right-3 bottom-3 left-3 z-10 flex items-center gap-3 rounded-card border border-line bg-canvas/95 px-3 py-2 shadow-md backdrop-blur"
          >
            <span
              className="flow-tile shrink-0"
              style={{ color: contextVar(context.id), width: 28, height: 28 }}
            >
              <Boxes size={15} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-semibold text-ink">
                  {context.name}
                </span>
                <span className="mono shrink-0 text-faint">
                  {context.id}
                  {context.classification ? ` · ${context.classification}` : ""}
                </span>
              </div>
              <div className="truncate text-sm text-muted">
                {context.summary || "\u00a0"}
              </div>
            </div>
            <div className="mono hidden shrink-0 gap-x-3 text-faint md:flex">
              <span>
                <span className="tnum text-ink">{stats.services}</span> services
              </span>
              <span>
                <span className="tnum text-ink">{stats.aggregates}</span>{" "}
                aggregates
              </span>
              <span>
                <span className="tnum text-ink">{stats.events}</span> events
              </span>
            </div>
            <Link
              to={catalogTo(paths.context(context.id))}
              className="pointer-events-auto inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline"
            >
              Open <ArrowRight size={13} />
            </Link>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
