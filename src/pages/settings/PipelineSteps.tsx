import { plural } from "../../lib/format";
import type { SetupRunStep } from "../../lib/setup-info";
import { sourceHref } from "../../lib/source-link";
import { warningDiagnostic } from "../../lib/warnings";
import { duration, StepStatus } from "./health";
import { WarningPanel } from "./WarningPanel";

export function FileLink({ path }: { path: string }) {
  const href = sourceHref(path, null);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-control text-accent hover:underline">
      {path} ↗
    </a>
  ) : (
    <span title={path}>{path}</span>
  );
}

export function PipelineSteps({ steps }: { steps: SetupRunStep[] }) {
  if (steps.length === 0) {
    return <p className="mono text-muted">No result recorded for these steps.</p>;
  }
  const warnings = steps.flatMap((step) => step.warnings.map((message) => ({ plugin: step.plugin, message })));
  const diagnostics = steps.flatMap((step) => step.diagnostics.length
    ? step.diagnostics
    : step.warnings.map((message) => warningDiagnostic({ plugin: step.plugin, message })));
  return (
    <div className="space-y-2">
      <div className="divide-y divide-line rounded-control border border-line">
        {steps.map((step) => (
          <div key={step.ordinal} className="px-3 py-2">
            <div className="grid gap-2 sm:grid-cols-[5rem_minmax(7rem,1fr)_auto_auto] sm:items-center">
              <span className="mono text-muted">{step.phase}</span>
              <span className="mono truncate text-ink" title={step.plugin}>{step.plugin}</span>
              <span className="mono text-muted">{step.fileCount} {plural(step.fileCount, "file")}</span>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="mono text-muted">{duration(step.durationMs)}</span>
                <StepStatus status={step.status} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {warnings.length ? <details open={warnings.length <= 5}>
        <summary className="mono cursor-pointer text-muted">{warnings.length} {plural(warnings.length, "warning")}</summary>
        <div className="mt-2"><WarningPanel diagnostics={diagnostics} compact /></div>
      </details> : null}
    </div>
  );
}
