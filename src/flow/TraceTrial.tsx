// A recording, uploaded, on its way into the catalog.
//
// The generator has run over a copy of the workspace with the recording in
// place, and this is what it said: the flows the recording showed, what it
// raised on them and what it added, and the names it could not place. The
// reader maps those names, keeps the recording or does not, and watches the
// real run when they keep it. The panel is the same on the flow page and in
// settings, because the questions are.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleAlert, LoaderCircle, Play, X } from "lucide-react";
import { Link } from "react-router";
import { catalog } from "../data";
import { useToastStore } from "../app/toast";
import { plural } from "../lib/format";
import {
  applyTraceTrial,
  cancelGeneration,
  disposeTraceTrial,
  subscribeToRun,
} from "../lib/local-api";
import type { RunEvent, TraceTrial } from "../lib/local-api";
import { paths } from "../routes";

type Mapping = Record<string, string>;

function useRunEvents(runId: string | null): RunEvent[] {
  const [events, setEvents] = useState<RunEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (!runId) return;
    return subscribeToRun(
      runId,
      (event) => setEvents((current) => [...current, event]),
      () => {},
    );
  }, [runId]);
  return events;
}

function Progress({ events, label }: { events: RunEvent[]; label: string }) {
  const pipeline = events.find((e) => e.type === "pipeline-ready");
  const steps = events.filter((e) => e.type === "step-finished");
  const active = events
    .slice()
    .reverse()
    .find((e): e is Extract<RunEvent, { type: "step-started" }> => e.type === "step-started");
  const total = pipeline?.type === "pipeline-ready" ? pipeline.stepCount : 0;
  const percent = total ? Math.round((steps.length / total) * 100) : 0;
  return (
    <div>
      <div className="mono flex items-center gap-2 text-muted">
        <LoaderCircle size={14} className="animate-spin text-accent" />
        {active ? `${active.phase} · ${active.plugin}` : label}
        <span className="ml-auto">{steps.length} / {total || "?"}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Logs({ events }: { events: RunEvent[] }) {
  const logs = events.filter((e) => e.type === "log");
  if (!logs.length) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary>
      <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">
        {logs.map((e) => (e.type === "log" ? e.message : "")).join("\n")}
      </pre>
    </details>
  );
}

/**
 * A name the verifier could not place, and the catalog id it should be.
 * The list of ids is offered rather than enforced: the verifier says when
 * the id names nothing, on the next run.
 */
function MappingRow({
  kind,
  name,
  value,
  onChange,
}: {
  kind: "service" | "event";
  name: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const listId = `trace-${kind}-ids`;
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
      <span className="mono truncate text-ink" title={name}>{name}</span>
      <span className="mono text-faint">is {kind}</span>
      <input
        className="mono w-full rounded-control border border-line bg-canvas px-2.5 py-1.5 text-ink"
        list={listId}
        value={value}
        placeholder={kind === "service" ? "context.service" : "context.service.aggregate.Event"}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Catalog ${kind} for ${name}`}
      />
    </div>
  );
}

function IdLists() {
  const services = useMemo(
    () => catalog.contexts.flatMap((c) => c.services.map((s) => s.id)),
    [],
  );
  const events = useMemo(
    () =>
      catalog.contexts.flatMap((c) =>
        c.services.flatMap((s) => s.aggregates.flatMap((a) => a.events.map((e) => e.id))),
      ),
    [],
  );
  return (
    <>
      <datalist id="trace-service-ids">{services.map((id) => <option key={id} value={id} />)}</datalist>
      <datalist id="trace-event-ids">{events.map((id) => <option key={id} value={id} />)}</datalist>
    </>
  );
}

function FlowRow({ flow }: { flow: TraceTrial["flows"][number] }) {
  return (
    <div className="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <Link to={paths.flow(flow.slug)} className="truncate font-medium text-ink hover:underline" title={flow.id}>
          {flow.name}
        </Link>
        <div className="mono mt-0.5 flex flex-wrap gap-x-2 text-muted">
          <span>{flow.kind === "observed" ? "no flow in the catalog opens this way" : `${flow.verified} of ${flow.steps} steps verified`}</span>
          {flow.added ? <span>+{flow.added} {plural(flow.added, "hop")} the code does not declare</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        {flow.inRecording ? (
          <span className="chip status-verified" title="Traces in this recording that showed the flow">
            {flow.traces} {plural(flow.traces, "trace")} · {flow.shown} {plural(flow.shown, "step")} shown
          </span>
        ) : (
          <span className="chip" title="Written from recordings the project already had">from earlier recordings</span>
        )}
      </div>
    </div>
  );
}

/**
 * The panel. `runId` is the trial run; when the recording is kept and the
 * reader asked for it, the write run takes its place until it finishes.
 */
export function TraceTrialPanel({
  runId,
  onDone,
}: {
  runId: string;
  /** The trial is over: kept and regenerated, kept, or discarded. */
  onDone: (outcome: "kept" | "discarded") => void;
}) {
  const say = useToastStore((s) => s.say);
  const trialEvents = useRunEvents(runId);
  const [writeRunId, setWriteRunId] = useState<string | null>(null);
  const writeEvents = useRunEvents(writeRunId);
  const [services, setServices] = useState<Mapping>({});
  const [events, setEvents] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<{ recording: string; manifestChanged: boolean } | null>(null);

  const trial = trialEvents.find(
    (e): e is Extract<RunEvent, { type: "trace-trial-ready" }> => e.type === "trace-trial-ready",
  );
  const trialFinished = trialEvents.find(
    (e): e is Extract<RunEvent, { type: "process-finished" }> => e.type === "process-finished",
  );
  const writeFinished = writeEvents.find(
    (e): e is Extract<RunEvent, { type: "process-finished" }> => e.type === "process-finished",
  );

  const unplaced = useMemo(() => {
    const seen = new Set<string>();
    return (trial?.warnings ?? []).filter((w) => {
      if ((w.kind !== "service" && w.kind !== "event") || !w.name) return false;
      const key = `${w.kind}:${w.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [trial]);
  const others = (trial?.warnings ?? []).filter((w) => w.kind !== "service" && w.kind !== "event");
  const shown = (trial?.flows ?? []).filter((f) => f.inRecording);
  const rest = (trial?.flows ?? []).filter((f) => !f.inRecording);

  async function keep(generate: boolean) {
    setBusy(true);
    try {
      const clean = (m: Mapping) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      const result = await applyTraceTrial(runId, { generate, services: clean(services), events: clean(events) });
      setKept({ recording: result.recording, manifestChanged: result.manifestChanged });
      if (result.run) setWriteRunId(result.run.runId);
      else {
        say(`${result.recording} kept`);
        onDone("kept");
      }
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await disposeTraceTrial(runId);
    } catch {
      // Already gone is discarded too.
    } finally {
      setBusy(false);
      onDone("discarded");
    }
  }

  // The write run: the recording is on disk, the catalog is being written.
  if (writeRunId) {
    return (
      <div className="flex flex-col gap-3">
        {writeFinished ? (
          <div className="flex items-start gap-2">
            {writeFinished.status === "ok" ? null : <CircleAlert size={16} className="mt-0.5 shrink-0 text-muted" />}
            <div>
              <div className="font-medium text-ink">
                {writeFinished.status === "ok" ? "Recording kept and documentation regenerated" : `Regeneration ${writeFinished.status}`}
              </div>
              <div className="mono mt-0.5 text-muted">{kept?.recording}</div>
            </div>
          </div>
        ) : (
          <Progress events={writeEvents} label="regenerating with the recording in place…" />
        )}
        <Logs events={writeEvents} />
        <div className="flex justify-end gap-2">
          {writeFinished ? (
            <button type="button" className="product-primary" onClick={() => onDone("kept")}>Done</button>
          ) : (
            <button type="button" className="tbtn" onClick={() => void cancelGeneration(writeRunId)}>Cancel</button>
          )}
        </div>
      </div>
    );
  }

  if (!trialFinished) {
    return (
      <div className="flex flex-col gap-3">
        <Progress events={trialEvents} label="reading the recording against the catalog…" />
        <Logs events={trialEvents} />
        <div className="flex justify-end">
          <button type="button" className="tbtn" onClick={() => void cancelGeneration(runId)}>Cancel</button>
        </div>
      </div>
    );
  }

  if (!trial) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-ink">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-muted" />
          <div>The generator did not finish with the recording in place ({trialFinished.status}). Nothing was written.</div>
        </div>
        <Logs events={trialEvents} />
        <div className="flex justify-end">
          <button type="button" className="tbtn" onClick={() => void discard()} disabled={busy}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <IdLists />
      <div>
        <div className="mono text-muted">
          {trial.spans} {plural(trial.spans, "span")} · lands at <span className="text-ink">{trial.recording}</span>
          {trial.stepChange === "added" ? " · adds a verify step to portolan.json" : trial.stepChange === "widened" ? " · points the project's verify step at the recordings directory" : ""}
        </div>
      </div>

      <section>
        <div className="label mb-1.5">flows this recording showed · {shown.length}</div>
        {shown.length ? (
          <div className="divide-y divide-line rounded-control border border-line">
            {shown.map((flow) => <FlowRow key={flow.id} flow={flow} />)}
          </div>
        ) : (
          <div className="rounded-control border border-line bg-surface px-3 py-3 text-muted">
            No trace in the recording opened a flow of this project. A trace opens a flow on the operation it calls in on or the event that arrives; a service the catalog does not know is reported below.
          </div>
        )}
        {rest.length ? (
          <details className="mt-2 group">
            <summary className="flex cursor-pointer items-center gap-1 text-muted">
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              {rest.length} {plural(rest.length, "flow")} written from recordings the project already had
            </summary>
            <div className="mt-2 divide-y divide-line rounded-control border border-line">
              {rest.map((flow) => <FlowRow key={flow.id} flow={flow} />)}
            </div>
          </details>
        ) : null}
      </section>

      {unplaced.length ? (
        <section>
          <div className="label mb-1.5">names the verifier could not place · {unplaced.length}</div>
          <p className="mb-2 text-muted">
            Say which catalog entry each one is and the mapping is kept in the verify step for every run after this one. Leave one empty to keep the spans it names out.
          </p>
          <div className="flex flex-col gap-2">
            {unplaced.map((w) =>
              w.kind === "service" ? (
                <MappingRow key={`s:${w.name}`} kind="service" name={w.name!} value={services[w.name!] ?? trial.mappings.services[w.name!] ?? ""} onChange={(v) => setServices((m) => ({ ...m, [w.name!]: v }))} />
              ) : (
                <MappingRow key={`e:${w.name}`} kind="event" name={w.name!} value={events[w.name!] ?? trial.mappings.events[w.name!] ?? ""} onChange={(v) => setEvents((m) => ({ ...m, [w.name!]: v }))} />
              ),
            )}
          </div>
        </section>
      ) : null}

      {others.length ? (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-muted">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            {others.length} {plural(others.length, "other warning")}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {others.map((w, i) => <li key={i} className="mono text-muted">{w.message}</li>)}
          </ul>
        </details>
      ) : null}

      <Logs events={trialEvents} />

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="tbtn" onClick={() => void discard()} disabled={busy}>
          <X size={14} /> Discard
        </button>
        <button type="button" className="tbtn" onClick={() => void keep(false)} disabled={busy} title="Write the recording beside the project without regenerating now">
          Keep only
        </button>
        <button type="button" className="product-primary" onClick={() => void keep(true)} disabled={busy}>
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />} Keep and regenerate
        </button>
      </div>
    </div>
  );
}
