import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, LoaderCircle, Play, X } from "lucide-react";
import { plural } from "../../lib/format";
import { cancelGeneration, subscribeToRun } from "../../lib/local-api";
import type { RunEvent } from "../../lib/local-api";
import { paths } from "../../routes";
import { Modal } from "../../components/Overlay";

export function RunDialog({ runId, open, onClose, onFinished, onApply }: { runId: string | null; open: boolean; onClose: () => void; onFinished: () => void; onApply: (previewRunId: string) => void }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const finished = events.slice().reverse().find(
    (event): event is Extract<RunEvent, { type: "process-finished" }> => event.type === "process-finished",
  );
  const pipeline = events.find((event) => event.type === "pipeline-ready");
  const steps = events.filter((event) => event.type === "step-finished");
  const active = events.slice().reverse().find(
    (event): event is Extract<RunEvent, { type: "step-started" }> => event.type === "step-started",
  );
  const logs = events.filter((event) => event.type === "log");
  const run = events.find((event): event is Extract<RunEvent, { type: "run-started" }> => event.type === "run-started");
  const preview = events.find((event): event is Extract<RunEvent, { type: "preview-ready" }> => event.type === "preview-ready");
  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    return subscribeToRun(runId, (event) => { setEvents((current) => [...current, event]); if (event.type === "process-finished") onFinished(); }, onFinished);
  }, [runId, onFinished]);
  const total = pipeline?.type === "pipeline-ready" ? pipeline.stepCount : 0;
  const percent = total ? Math.round((steps.length / total) * 100) : 0;
  return (
    <Modal open={open} onClose={finished ? onClose : () => {}} label="Generate documentation" width="min(720px,94vw)">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex-1">
          <div className="font-semibold text-ink">{run?.mode === "preview" ? "Preview generated changes" : "Generate documentation"}</div>
          <div className="mono mt-0.5 text-muted">
            {finished
              ? `finished · ${finished.status}`
              : active?.type === "step-started"
                ? `${active.phase} · ${active.plugin}`
                : run?.mode === "preview"
                  ? "creating an isolated workspace…"
                  : "starting generator…"}
          </div>
        </div>
        {finished ? (
          <button className="tbtn p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        ) : (
          <LoaderCircle size={18} className="animate-spin text-accent" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div className="mono mt-2 flex justify-between text-muted">
          <span>{steps.length} / {total || "?"} steps</span>
          <span>{percent}%</span>
        </div>
        <div className="mt-4 divide-y divide-line rounded-control border border-line">
          {steps.map((event) => event.type === "step-finished" ? (
            <div key={`${event.ordinal}:${event.plugin}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr_auto]">
              <span className="mono text-muted">{event.phase}</span>
              <span className="mono text-ink">{event.plugin}</span>
              <span className={`chip ${event.status === "failed" ? "status-unresolved" : "status-verified"}`}>{event.status}</span>
            </div>
          ) : null)}
        </div>
        {preview ? (
          <section className="mt-5">
            <div className="label mb-2">generated diff · {preview.totalFiles} {plural(preview.totalFiles, "file")}</div>
            {preview.files.length ? (
              <div className="divide-y divide-line overflow-hidden rounded-control border border-line">
                {preview.files.map((file) => (
                  <details key={file.path} className="group">
                    <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface">
                      <span className={`chip ${file.status === "removed" ? "status-unresolved" : file.status === "added" ? "status-verified" : "status-declared"}`}>{file.status}</span>
                      <span className="mono truncate text-ink">{file.path}</span>
                      <ChevronDown size={15} className="ml-auto shrink-0 text-muted transition-transform group-open:rotate-180" />
                    </summary>
                    <pre className="mono max-h-80 overflow-auto whitespace-pre p-3 text-muted bg-surface">{file.diff || "Binary file changed"}</pre>
                  </details>
                ))}
              </div>
            ) : (
              <div className="rounded-control border border-line bg-surface px-3 py-3 text-muted">Generated documentation is already up to date.</div>
            )}
            {preview.truncated ? <p className="mt-2 text-muted">Showing the first {preview.files.length} changed files.</p> : null}
          </section>
        ) : null}
        {logs.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary>
            <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">
              {logs.map((event) => event.type === "log" ? event.message : "").join("\n")}
            </pre>
          </details>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
        {finished ? (
          <>
            {run?.mode === "write" && finished.status === "ok" ? (
              <>
                <Link to={`${paths.map()}?tour=1`} className="product-primary" onClick={onClose}>Explore the map</Link>
                <Link to={paths.settingsDelivery()} className="tbtn" onClick={onClose}>Set up publishing</Link>
              </>
            ) : null}
            <button type="button" className="tbtn" onClick={onClose}>{preview?.files.length ? "Cancel" : "Done"}</button>
            {preview?.files.length && finished.status === "ok" && runId ? (
              <button type="button" className="product-primary" onClick={() => onApply(runId)}>
                <Play size={15} /> Apply changes
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="tbtn" onClick={() => runId && void cancelGeneration(runId)}>Cancel generation</button>
        )}
      </div>
    </Modal>
  );
}
