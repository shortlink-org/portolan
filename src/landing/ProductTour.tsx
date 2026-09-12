// Four stops through the product, on the example estate. Two of them are the
// product's own canvases in a smaller box; the other two are read straight
// out of the same catalog. Nothing on this page is drawn from a mock-up.

import { lazy, Suspense, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  ExternalLink,
  FileCode2,
  GitBranch,
  Network,
  Radio,
} from "lucide-react";
import { index } from "../data";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { contextVar } from "../lib/context-color";
import { useProblems } from "../lib/use-problems";
import {
  AnimatePresence,
  LayoutGroup,
  m,
  page,
  staggerStyle,
  transitions,
} from "../lib/motion";
import { eventPath, paths } from "../routes";
import { catalogTo } from "./catalog";
import { ProductFrame } from "./ProductFrame";
import { DraggableReveal } from "./DraggableReveal";

type DemoId = "estate" | "flow" | "contract" | "problems";

// The two canvases carry elk and React Flow; they arrive when their tab does.
const EstateGraph = lazy(() =>
  import("./EstateGraph").then((mod) => ({ default: mod.EstateGraph })),
);
const FlowPlayback = lazy(() =>
  import("./FlowPlayback").then((mod) => ({ default: mod.FlowPlayback })),
);

const tours: Array<{
  id: DemoId;
  number: string;
  title: string;
  copy: string;
  icon: typeof Network;
}> = [
  {
    id: "estate",
    number: "01",
    title: "See the whole estate",
    copy: "See every service and event between them. Switch views, focus a service, or export the map.",
    icon: Network,
  },
  {
    id: "flow",
    number: "02",
    title: "Follow one real flow",
    copy: "Follow a checkout across HTTP, gRPC, the database and the bus, one step at a time, with its source line.",
    icon: GitBranch,
  },
  {
    id: "contract",
    number: "03",
    title: "Inspect the contract",
    copy: "The event's payload, the channel it leaves on, who listens, and the file it was read from.",
    icon: Braces,
  },
  {
    id: "problems",
    number: "04",
    title: "Catch architecture drift",
    copy: "Catch unresolved calls, second writers and unpublished channels during the merge, before review.",
    icon: AlertTriangle,
  },
];

const EVENT_ID = "shop.cart.basket.BasketCheckedOut";

function ContractDemo() {
  const event = index.eventById.get(EVENT_ID);
  const owner = index.eventOwner.get(EVENT_ID);
  const version = event?.versions.at(-1);
  const href = eventPath(EVENT_ID);
  if (!event || !owner || !version) {
    return (
      <div className="p-6 text-sm text-muted">
        The example catalog does not carry {EVENT_ID}.
      </div>
    );
  }
  const context = index.serviceContext.get(owner.service.id);

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-event">domain event · {version.version}</div>
          <div className="mt-1 text-md font-semibold text-ink">{event.name}</div>
          <div className="mono mt-1 truncate text-muted">{event.id}</div>
        </div>
        {event.wire ? (
          <span className="chip status-verified">
            <Radio size={12} /> {event.wire.channel ?? event.wire.name}
          </span>
        ) : null}
      </div>
      {version.doc ? (
        <p className="mt-3 max-w-[560px] text-sm leading-6 text-muted">
          {version.doc}
        </p>
      ) : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="overflow-hidden rounded-card border border-line bg-canvas">
          <div className="label border-b border-line bg-surface px-3 py-2">
            payload
          </div>
          {version.fields.map((field, i) => (
            <div
              key={field.name}
              style={staggerStyle(i)}
              className="stagger-in grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line px-3 py-2 last:border-b-0"
            >
              <span className="mono text-ink">{field.name}</span>
              <span className="mono text-muted">{field.type}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="label mb-2">
            published by
          </div>
          <div
            className="rounded-control border border-line bg-canvas p-2.5"
            style={{ color: contextVar(context?.id) }}
          >
            <div className="font-medium text-ink">{owner.service.id}</div>
            <div className="mono mt-0.5 text-muted">{owner.aggregate.name}</div>
          </div>
          <div className="label mt-4 mb-2">
            consumed by
          </div>
          {event.consumers.length === 0 ? (
            <div className="mono text-faint">nobody yet</div>
          ) : (
            <div className="space-y-2">
              {event.consumers.map((consumer, i) => (
                <div
                  key={consumer.service}
                  style={staggerStyle(i + 2)}
                  className="stagger-in flex items-center justify-between gap-2 rounded-control border border-line bg-canvas p-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">
                      {consumer.service}
                    </div>
                    {consumer.note ? (
                      <div className="mono mt-0.5 truncate text-muted">
                        {consumer.note}
                      </div>
                    ) : null}
                  </div>
                  <span className={`chip status-${consumer.status}`}>
                    {consumer.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="mono flex min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-muted">
          <FileCode2 size={13} className="shrink-0" />
          <span className="truncate">{version.source}</span>
          <ExternalLink size={12} className="ml-auto shrink-0" />
        </div>
        {href ? (
          <Link
            to={catalogTo(href)}
            className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline"
          >
            Open the event <ArrowRight size={13} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const SHOWN_PROBLEMS = 4;

function ProblemsDemo() {
  const all = useProblems();
  const errors = all.filter((p) => p.severity === "error").length;
  const shown = all.slice(0, SHOWN_PROBLEMS);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-md font-semibold text-ink">
            Architecture problems
          </div>
          <div className="mt-1 text-sm text-muted">
            Every edge that leaves the measured model, found at merge time
          </div>
        </div>
        <div className="flex gap-2">
          {errors > 0 ? (
            <span className="chip status-unresolved">{errors} errors</span>
          ) : null}
          {all.length - errors > 0 ? (
            <span className="chip status-declared">
              {all.length - errors} warnings
            </span>
          ) : null}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-card border border-line bg-canvas p-4 text-sm text-muted">
          Nothing leaves the model: every call and every consumer resolves.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((problem, i) => (
            <div
              key={`${problem.kind}:${problem.id}:${problem.peer}`}
              style={staggerStyle(i)}
              className="stagger-in grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 rounded-card border border-line bg-canvas p-3"
            >
              <AlertTriangle
                size={16}
                className={
                  problem.severity === "error"
                    ? "mt-0.5 text-unresolved"
                    : "mt-0.5 text-declared"
                }
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">
                  {problem.note ?? problem.id}
                </div>
                <div
                  className="mono mt-1 truncate text-muted"
                  title={`${problem.service} → ${problem.peer}`}
                >
                  <span style={{ color: contextVar(problem.context) }}>
                    {problem.service}
                  </span>{" "}
                  → {problem.peer}
                </div>
              </div>
              <span className="chip border-line text-muted">
                {problem.kind}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="mono text-faint">
          {all.length > shown.length
            ? `${all.length - shown.length} more on the problems page`
            : `${all.length} in total`}
        </span>
        <Link
          to={catalogTo(paths.problems())}
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          Open the problems page <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function Demo({ id }: { id: DemoId }) {
  switch (id) {
    case "flow":
      return <FlowPlayback />;
    case "contract":
      return <ContractDemo />;
    case "problems":
      return <ProblemsDemo />;
    default:
      return <EstateGraph />;
  }
}

export function ProductTour() {
  const [active, setActive] = useState<DemoId>("estate");
  const selected = tours.find((tour) => tour.id === active) ?? tours[0]!;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.55fr)] lg:gap-12">
      <LayoutGroup id="product-tour">
        <div
          role="tablist"
          aria-label="Portolan product tour"
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
        >
          {tours.map((tour) => {
            const Icon = tour.icon;
            const on = tour.id === active;
            return (
              <button
                key={tour.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="landing-product-demo"
                onClick={() => setActive(tour.id)}
                className={`group relative rounded-card border border-line/60 p-4 text-left transition-colors ${
                  on ? "" : "hover:border-line-strong hover:bg-surface"
                }`}
              >
                {on ? (
                  <m.span
                    layoutId="tour-ring"
                    transition={transitions.settle}
                    className="absolute inset-0 rounded-card border border-accent bg-accent/5"
                    aria-hidden
                  />
                ) : null}
                <div className="relative flex items-center gap-3">
                  <span
                    className={`mono flex size-8 items-center justify-center rounded-control border transition-colors ${
                      on
                        ? "border-accent text-accent"
                        : "border-line text-muted group-hover:text-ink"
                    }`}
                  >
                    <Icon size={15} aria-hidden />
                  </span>
                  <div>
                    <div className="mono text-faint">{tour.number}</div>
                    <div className="font-semibold text-ink">{tour.title}</div>
                  </div>
                </div>
                <p className="relative mt-3 text-sm text-muted">{tour.copy}</p>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <div id="landing-product-demo" role="tabpanel" aria-live="polite">
        <DraggableReveal>
          <ProductFrame
            title={`${selected.title} · portolan`}
            eyebrow={active}
            // The two canvases want every pixel of width they can get.
            aside={active === "contract" || active === "problems"}
          >
            <AnimatePresence mode="wait" initial={false}>
              <m.div key={active} {...page} className="relative min-h-[470px]">
                <Suspense fallback={<DiagramSkeleton />}>
                  <Demo id={active} />
                </Suspense>
              </m.div>
            </AnimatePresence>
          </ProductFrame>
        </DraggableReveal>
      </div>
    </div>
  );
}
