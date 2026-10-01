import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { plural } from "../../lib/format";
import { DjangoAggregateChoices } from "./DjangoAggregateChoices";
import { djangoAggregateCandidates, djangoAggregateMessage } from "../../lib/django-aggregates";
import { groupDiagnostics } from "../../lib/warnings";
import type { WarningDiagnostic, WarningSeverity } from "../../lib/warnings";
import { FIELD } from "./Field";

export function WarningPanel({ diagnostics, compact = false }: { diagnostics: WarningDiagnostic[]; compact?: boolean }) {
  const groups = groupDiagnostics(diagnostics);
  const plugins = [...new Set(groups.map((group) => group.plugin))].sort();
  const rules = [...new Set(groups.map((group) => group.rule))].sort();
  const [plugin, setPlugin] = useState("all");
  const [rule, setRule] = useState("all");
  const [severity, setSeverity] = useState<WarningSeverity | "all">("all");
  const [visibility, setVisibility] = useState<"active" | "suppressed" | "all">("active");
  const shown = groups.filter((group) =>
    (plugin === "all" || group.plugin === plugin)
    && (rule === "all" || group.rule === rule)
    && (severity === "all" || group.severity === severity)
    && (visibility === "all" || (visibility === "suppressed") === group.suppressed),
  );
  const activeCount = groups.filter((group) => !group.suppressed).reduce((sum, group) => sum + group.count, 0);
  const suppressedCount = diagnostics.length - activeCount;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-muted">{activeCount} active · {groups.length} {plural(groups.length, "rule")}</span>
        {suppressedCount ? <span className="chip status-verified">{suppressedCount} suppressed</span> : null}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {plugins.length > 1 ? (
            <select
              aria-label="Filter warnings by plugin"
              className={`${FIELD} w-auto py-1`}
              value={plugin}
              onChange={(event) => setPlugin(event.target.value)}
            >
              <option value="all">all plugins</option>
              {plugins.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : null}
          {rules.length > 1 ? (
            <select
              aria-label="Filter warnings by rule"
              className={`${FIELD} w-auto py-1`}
              value={rule}
              onChange={(event) => setRule(event.target.value)}
            >
              <option value="all">all rules</option>
              {rules.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : null}
          <select
            aria-label="Filter warnings by severity"
            className={`${FIELD} w-auto py-1`}
            value={severity}
            onChange={(event) => setSeverity(event.target.value as WarningSeverity | "all")}
          >
            <option value="all">all severities</option>
            <option value="error">error</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
          <select
            aria-label="Filter active or suppressed warnings"
            className={`${FIELD} w-auto py-1`}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as "active" | "suppressed" | "all")}
          >
            <option value="active">active</option>
            <option value="suppressed">suppressed</option>
            <option value="all">all</option>
          </select>
        </div>
      </div>
      {shown.length ? (
        <div className="space-y-2">
          {shown.map((group) => {
            const color = group.severity === "error" ? "text-unresolved" : group.severity === "warning" ? "text-declared" : "text-muted";
            const candidates = group.messages.filter((warning) => warning.aggregateCandidates || djangoAggregateCandidates(warning.message));
            const examples = group.messages.filter((warning) => !warning.aggregateCandidates && !djangoAggregateCandidates(warning.message)).slice(0, compact ? 3 : 12);
            return (
              <details
                key={`${group.plugin}:${group.rule}:${group.suppressed}`}
                className={`rounded-control border px-3 py-2 ${group.suppressed ? "border-line opacity-75" : group.severity === "error" ? "border-unresolved" : "border-line"}`}
                open={!compact && shown.length <= 4}
              >
                <summary className="cursor-pointer list-none">
                  <span className="flex flex-wrap items-center gap-2">
                    <CircleAlert size={15} className={`shrink-0 ${color}`} />
                    <span className="mono text-ink">{group.plugin}</span>
                    <span className={`chip ${group.severity === "error" ? "status-unresolved" : group.severity === "warning" ? "status-declared" : ""}`}>{group.severity}</span>
                    <span className="mono text-muted">{group.rule}</span>
                    <span className="chip ml-auto">×{group.count}</span>
                  </span>
                  <span className="mt-1 block text-muted"><span className="font-medium text-ink">Next:</span> {group.action}</span>
                  {group.suppressionReason ? <span className="mt-1 block text-muted"><span className="font-medium text-ink">Suppressed:</span> {group.suppressionReason}</span> : null}
                </summary>
                <ul className="mono mt-2 space-y-1 text-muted">
                  {examples.map((warning, index) => (
                    <li key={`${index}:${warning.message}`} className="break-words border-l-2 border-line pl-2">
                      {djangoAggregateMessage(warning.message)}
                    </li>
                  ))}
                </ul>
                {candidates.length ? <DjangoAggregateChoices warnings={candidates} /> : null}
                {group.count > examples.length + candidates.length ? (
                  <p className="mono mt-2 text-faint">{group.count - examples.length - candidates.length} more occurrences</p>
                ) : null}
              </details>
            );
          })}
        </div>
      ) : (
        <p className="rounded-control border border-line px-3 py-2 text-muted">No warnings match these filters.</p>
      )}
      {!compact && groups.some((group) => !group.suppressed) ? (
        <p className="text-faint">
          Suppress a reviewed limitation with a typed CEL entry in <span className="mono">portolan.json → warningPolicies</span>. The reason is required and remains visible here after regeneration.
        </p>
      ) : null}
    </div>
  );
}
