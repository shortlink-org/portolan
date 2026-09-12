// Recordings, for the whole estate: what the catalog was verified against,
// and a place to add one without first finding the flow it shows.
//
// A recording added here goes to the project the reader names. The trial
// then says which flows it showed - which is how a reader with an export
// from the collector and no idea which flow it is finds out.

import { useMemo, useRef, useState } from "react";
import { Disc3, Upload } from "lucide-react";
import { Link } from "react-router";
import { catalog } from "../../data";
import { useToastStore } from "../../app/toast";
import { TraceTrialPanel } from "../../flow/TraceTrial";
import { plural } from "../../lib/format";
import { startTraceTrial } from "../../lib/local-api";
import type { SetupProject } from "../../lib/setup-info";
import { paths } from "../../routes";

const FIELD = "w-full rounded-control border border-line bg-canvas px-2.5 py-1.5 text-ink";

/** Every recording the catalog names, with the flows it is an example of. */
function recordingsInCatalog() {
  const byFile = new Map<string, { traces: Set<string>; flows: Map<string, string> }>();
  for (const flow of catalog.flows) {
    for (const example of flow.examples ?? []) {
      const entry = byFile.get(example.recording) ?? { traces: new Set(), flows: new Map() };
      entry.traces.add(example.traceId);
      entry.flows.set(flow.slug, flow.name);
      byFile.set(example.recording, entry);
    }
  }
  return [...byFile.entries()]
    .map(([recording, entry]) => ({ recording, traces: entry.traces.size, flows: [...entry.flows.entries()] }))
    .sort((a, b) => a.recording.localeCompare(b.recording));
}

export function RecordingSettings({ local, projects }: { local: boolean; projects: readonly SetupProject[] }) {
  const say = useToastStore((s) => s.say);
  const input = useRef<HTMLInputElement | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(recordingsInCatalog, []);

  async function upload(file: File) {
    if (!projectId) return;
    setBusy(true);
    try {
      const started = await startTraceTrial(file, projectId);
      setRunId(started.runId);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <Disc3 size={16} className="text-accent" /> Add a recording
        </div>
        <p className="mt-1 max-w-prose text-muted">
          An OTLP JSON export - one batch per file or one per line, as a collector's file exporter writes it. The generator runs over a copy of the workspace with it in place and shows which flows it verified, what it added to them and which names it could not place, before the recording is kept beside the project.
        </p>
        {local ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-56">
              <span className="label mb-1.5 block">project</span>
              <select className={FIELD} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.length ? null : <option value="">no projects in portolan.json</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.root}</option>)}
              </select>
            </label>
            <button type="button" className="product-primary" disabled={busy || !projectId || runId !== null} onClick={() => input.current?.click()}>
              <Upload size={14} /> Choose a file
            </button>
            <input
              ref={input}
              type="file"
              accept=".jsonl,.json,.ndjson,application/json"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }}
            />
          </div>
        ) : (
          <div className="empty mt-3">
            Start <code>portolan dev</code> to add recordings in this repository.
          </div>
        )}
        {runId ? (
          <div className="mt-4 border-t border-line pt-4">
            <TraceTrialPanel runId={runId} onDone={() => setRunId(null)} />
          </div>
        ) : null}
      </div>

      <section>
        <div className="label mb-2">recordings the catalog was verified against · {known.length}</div>
        {known.length ? (
          <div className="divide-y divide-line rounded-control border border-line">
            {known.map((entry) => (
              <div key={entry.recording} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="mono truncate text-ink" title={entry.recording}>{entry.recording}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-muted">
                    {entry.flows.map(([slug, name]) => (
                      <Link key={slug} to={paths.flow(slug)} className="hover:underline">{name}</Link>
                    ))}
                  </div>
                </div>
                <span className="mono text-muted sm:text-right">{entry.traces} {plural(entry.traces, "trace")} kept as {plural(entry.traces, "an example", "examples")}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-control border border-line bg-surface px-3 py-3 text-muted">
            No flow in this catalog carries a recording yet. A verify step with the otel plugin reads them; adding one above writes that step for you.
          </div>
        )}
      </section>
    </div>
  );
}
