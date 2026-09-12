// The recordings a flow has been seen running in, and the way to add one.
//
// A recording is an example of the flow: which steps ran, how long each took,
// what the spans were called. Choosing one lights the steps it showed on the
// picture; the step's own panel says what the span carried. In local mode the
// same box takes a new recording, runs the generator over a copy with it in
// place, and shows what changed before anything is written.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Disc3, LoaderCircle, Upload } from "lucide-react";
import { Link } from "react-router";
import type { Flow, FlowExample } from "../catalog";
import { Modal } from "../components/Overlay";
import { useToastStore } from "../app/toast";
import { plural, relativeTime } from "../lib/format";
import { startTraceTrial } from "../lib/local-api";
import { localStatusQuery } from "../lib/queries";
import { projectForFlow, projectsForFlow } from "../lib/trace-project";
import { paths } from "../routes";
import { formatMs, stepsShownBy } from "./examples";
import { TraceTrialPanel } from "./TraceTrial";
import { forgetTraceTrial, recallTraceTrial, rememberTraceTrial, sessionStore } from "./trace-trial-resume";

function shortRecording(recording: string): string {
  const parts = recording.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : recording;
}

export function Recordings({
  flow,
  exampleId,
  onExample,
}: {
  flow: Flow;
  /** The example lit on the picture, or null. */
  exampleId: string | null;
  onExample: (id: string | null) => void;
}) {
  const status = useQuery(localStatusQuery());
  const local = status.isSuccess;
  const projects = status.data?.setup.projects ?? [];
  /**
   * A run the page did not start, or lost: keeping a recording writes
   * portolan.json, which restarts the dev server and reloads the page
   * under the dialog. The run goes on; the page says so.
   */
  const activeRun = status.data?.activeRun ?? null;
  const say = useToastStore((s) => s.say);
  const input = useRef<HTMLInputElement | null>(null);
  // Picked back up from before a reload, when this page was watching one:
  // keeping a recording reloads the page twice, and the dialog outlives it.
  const [resumed] = useState(() => recallTraceTrial(sessionStore(), flow.slug));
  const [runId, setRunId] = useState<string | null>(resumed?.runId ?? null);
  const [busy, setBusy] = useState(false);
  const watch = (id: string) => {
    rememberTraceTrial(sessionStore(), flow.slug, { runId: id, writeRunId: null });
    setRunId(id);
  };
  const done = () => {
    forgetTraceTrial(sessionStore());
    setRunId(null);
  };
  const examples = flow.examples ?? [];
  const project = local ? projectForFlow(projects, flow) : null;
  const candidates = local ? projectsForFlow(projects, flow) : [];
  const [chosenProject, setChosenProject] = useState<string>("");
  const target = project?.id ?? chosenProject;

  async function upload(file: File) {
    if (!target) return;
    setBusy(true);
    try {
      const started = await startTraceTrial(file, target);
      watch(started.runId);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (examples.length === 0 && !local) return null;

  return (
    <section className="border-b border-line px-3 py-2" aria-label="Recordings">
      <div className="flex items-center gap-2">
        <span className="label flex items-center gap-1 text-faint">
          <Disc3 size={12} aria-hidden /> recordings
        </span>
        <span className="mono text-muted">{examples.length}</span>
        {activeRun && runId === null ? (
          <Link to={paths.settings()} className="mono ml-auto flex items-center gap-1 text-muted hover:text-ink" title="A generator run is in progress; the page reloads when it has written">
            <LoaderCircle size={12} className="animate-spin text-accent" aria-hidden /> {activeRun.mode === "write" ? "regenerating…" : "run in progress…"}
          </Link>
        ) : local ? (
          <span className="ml-auto flex items-center gap-1.5">
            {candidates.length > 1 && !project ? (
              <select
                className="mono rounded-control border border-line bg-canvas px-1 py-0.5 text-ink"
                value={chosenProject}
                onChange={(e) => setChosenProject(e.target.value)}
                aria-label="Project to keep the recording under"
              >
                <option value="">project…</option>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : null}
            <button
              type="button"
              className="tbtn"
              disabled={busy || !target}
              title={target ? `Upload an OTLP JSON recording; it is kept under ${target} after you review what it shows` : candidates.length ? "Choose the project the recording belongs to" : "No project in this flow's context to keep a recording under"}
              onClick={() => input.current?.click()}
            >
              <Upload size={13} aria-hidden /> add
            </button>
            <input
              ref={input}
              type="file"
              accept=".jsonl,.json,.ndjson,application/json"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }}
            />
          </span>
        ) : null}
      </div>

      {examples.length ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {examples.map((example) => (
            <ExampleRow
              key={example.id}
              example={example}
              on={exampleId === example.id}
              onToggle={() => onExample(exampleId === example.id ? null : example.id)}
            />
          ))}
        </ul>
      ) : local ? (
        <p className="mt-1 text-muted">
          No recording shows this flow yet. Add an OTLP JSON export of a trace that runs through it, or see <Link to={paths.settingsRecordings()} className="text-accent hover:underline">recordings</Link> in settings.
        </p>
      ) : null}

      <Modal open={runId !== null} onClose={() => {}} label="Recording" width="min(760px,94vw)">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="flex-1">
            <div className="font-semibold text-ink">Recording of {flow.name}</div>
            <div className="mono mt-0.5 text-muted">read against the catalog, nothing written yet</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {runId ? (
            /* Keyed by the run: a dialog closing on one run and opening on
               the next within the exit animation must not hand the next run
               the state of the one before. */
            <TraceTrialPanel
              key={runId}
              runId={runId}
              initialWriteRunId={resumed?.runId === runId ? resumed.writeRunId : null}
              onWriteStarted={(writeRunId) => rememberTraceTrial(sessionStore(), flow.slug, { runId, writeRunId })}
              onDone={done}
            />
          ) : null}
        </div>
      </Modal>
    </section>
  );
}

function ExampleRow({
  example,
  on,
  onToggle,
}: {
  example: FlowExample;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={onToggle}
        className={`flex w-full flex-wrap items-baseline gap-x-2 rounded-control px-1.5 py-1 text-left hover:bg-surface ${on ? "bg-surface" : ""}`}
        title={`${example.recording} · trace ${example.traceId}`}
      >
        <span className="mono truncate text-ink">{shortRecording(example.recording)}</span>
        <span className="mono text-faint">#{example.traceId.slice(0, 8)}</span>
        <span className="mono ml-auto text-muted">
          {stepsShownBy(example).length} {plural(stepsShownBy(example).length, "step")}
          {example.durationMs ? ` · ${formatMs(example.durationMs)}` : ""}
          {example.recordedAt ? ` · ${relativeTime(example.recordedAt)}` : ""}
        </span>
      </button>
    </li>
  );
}
