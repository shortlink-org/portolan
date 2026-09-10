import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { djangoAggregateCandidates, djangoAggregateMessage } from "../../lib/django-aggregates";
import { djangoAggregateProposals, saveDjangoAggregates } from "../../lib/local-api";
import { localKeys, localStatusQuery } from "../../lib/queries";
import type { WarningDiagnostic } from "../../lib/warnings";
import { useToastStore } from "../../app/toast";

const CANDIDATE_KEY = ["local", "django-aggregates"];

export function DjangoAggregateChoices({ warnings }: { warnings: WarningDiagnostic[] }) {
  const status = useQuery(localStatusQuery());
  const queryClient = useQueryClient();
  const say = useToastStore((state) => state.say);
  const proposals = useQuery({
    queryKey: [...CANDIDATE_KEY, status.data?.setup.run?.finishedAt],
    queryFn: djangoAggregateProposals,
    enabled: status.isSuccess,
    retry: false,
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const rows = warnings.flatMap((warning) => {
    const candidates = warning.aggregateCandidates ?? djangoAggregateCandidates(warning.message);
    if (!candidates) return [];
    const matches = proposals.data?.proposals.filter((proposal) => proposal.plugin === warning.plugin && proposal.app === candidates.app
      && djangoAggregateMessage(proposal.message).slice(0, 500) === djangoAggregateMessage(warning.message).slice(0, 500)) ?? [];
    return [{ ...candidates, key: `${warning.plugin}:${warning.message}`, proposal: matches.length === 1 ? matches[0] : undefined }];
  });
  const selections = rows.flatMap((row) => row.proposal && choices[row.key] ? [{ id: row.proposal.id, model: choices[row.key]! }] : []);
  const canSave = Boolean(proposals.data && !proposals.data.stale && !status.data?.activeRun && selections.length && !busy);

  async function save() {
    if (!canSave || !proposals.data) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      await saveDjangoAggregates(proposals.data.revision, selections);
      setSaved(true);
      // Refreshing the manifest hides the now-stale report and unmounts this
      // picker; keep the next step visible outside that report.
      say("Aggregate roots saved to portolan.json. Preview generated diff to update the catalog.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CANDIDATE_KEY }),
        queryClient.invalidateQueries({ queryKey: localKeys.status }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return <div className="mt-3 space-y-3">
    <p className="text-muted">Choose the model that owns each application’s aggregate. Other concrete models become its entities.</p>
    {rows.map((row) => <div key={row.key} className="rounded-control border border-line p-3">
      <label className="block font-medium text-ink">
        Aggregate root for <span className="mono">{row.app}</span>
        <select aria-label={`Aggregate root for ${row.app}`} className="mt-2 block w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink" value={choices[row.key] ?? ""} onChange={(event) => { setChoices({ ...choices, [row.key]: event.target.value }); setSaved(false); }} disabled={busy}>
          <option value="">Choose a model…</option>
          {row.models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
        </select>
      </label>
      <details className="mt-2 text-muted">
        <summary className="cursor-pointer">{row.models.length} candidates · source locations</summary>
        <ul className="mono mt-2 space-y-1">{row.models.map((model) => <li key={model.name} className="break-words">{model.name} · {model.path}:{model.line}</li>)}</ul>
      </details>
      {choices[row.key] ? <pre className="mono mt-2 overflow-auto rounded-control bg-canvas p-2 text-ink">{JSON.stringify({ aggregates: { [row.app]: choices[row.key] } }, null, 2)}</pre> : null}
    </div>)}
    {status.isSuccess ? <>
      <button className="rounded-control border border-line bg-canvas px-3 py-2 font-medium text-accent hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void save()} disabled={!canSave}>{busy ? "Saving…" : "Save selected roots"}</button>
      <p className="text-muted">Saves to the matching extraction steps in portolan.json. Regenerate afterward to update the catalog and warnings.</p>
      {proposals.data?.stale && !saved ? <p className="text-declared">Regenerate before saving: these candidates belong to an older manifest.</p> : null}
      {proposals.isError ? <p role="alert" className="text-unresolved">Could not load the saved extraction report. Regenerate and reopen Settings.</p> : null}
      {rows.some((row) => !row.proposal) && proposals.isSuccess ? <p className="text-muted">Candidates from a trial can be saved after applying the project and generating its catalog.</p> : null}
    </> : <p className="text-muted">To save, open Portolan locally or copy the selected aggregates option into the matching extraction step in portolan.json.</p>}
    {saved ? <p role="status" className="text-verified">Aggregate roots saved. Regenerate to apply the choices to the catalog.</p> : null}
    {error ? <p role="alert" className="text-unresolved">{error}</p> : null}
  </div>;
}
