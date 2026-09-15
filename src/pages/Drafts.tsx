// Every saved branch draft of every project, with a way to make a new one
// while the dev server runs (portolan.0019).

import { AlertTriangle, Check, CircleSlash, GitBranch, GitCompare, History, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "../app/title";
import { useToastStore } from "../app/toast";
import { draftKey, short } from "../drafts/model";
import type { BranchChoice, Draft } from "../drafts/model";
import { counts, useDrafts } from "../drafts/store";
import { DraftChip, STATES, STATE_LABEL, STATE_TONE, StateChip, when } from "../drafts/ui";
import { paths } from "../routes";

function choiceFor(draft: Draft): BranchChoice {
  return { project: draft.project, branch: draft.branch, tip: draft.health.kind === "stale" ? draft.health.tip : draft.tip, ahead: 0 };
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function Drafts() {
  useDocumentTitle("Branch drafts");
  const drafts = useDrafts((s) => s.drafts);
  const enabled = useDrafts((s) => s.enabled);
  const toggle = useDrafts((s) => s.toggle);
  const remove = useDrafts((s) => s.remove);
  const restore = useDrafts((s) => s.restore);
  const generate = useDrafts((s) => s.generate);
  const generation = useDrafts((s) => s.generation);
  const mode = useDrafts((s) => s.mode);
  const outside = useDrafts((s) => s.outside);
  const refresh = useDrafts((s) => s.refresh);
  const say = useToastStore((s) => s.say);
  const [openLog, setOpenLog] = useState<string | null>(null);

  // What the dev server knows now: a branch that moved, went away or failed
  // to regenerate since the page was built.
  useEffect(() => {
    refresh().catch((cause) => say(`Could not read the drafts: ${message(cause)}`));
  }, [refresh, say]);

  const sorted = useMemo(
    () => [...drafts].sort((a, b) => a.projectName.localeCompare(b.projectName) || b.savedAt.localeCompare(a.savedAt)),
    [drafts],
  );
  const attention = drafts.filter((d) => d.health.kind !== "fresh").length;

  const drop = (draft: Draft) => {
    remove(draftKey(draft))
      .then((removed) => {
        if (removed) say(`Deleted the draft of ${draft.branch}`, { label: "Undo", run: () => void restore(removed).catch((cause) => say(message(cause))) });
      })
      .catch((cause) => say(`Could not delete the draft: ${message(cause)}`));
  };

  const regenerate = (draft: Draft) => {
    void generate(choiceFor(draft));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <div className="label">Branch drafts</div>
            <h1 className="mt-1 text-lg font-semibold">Branches</h1>
            <p className="mt-1 max-w-prose text-muted">
              What a feature branch adds to a project, compared from the commit it branched off. A draft stays until it is deleted here.
            </p>
          </div>
        </div>

        {mode === "dev" ? <NewDraft /> : null}

        <div className="mt-section flex items-center gap-3">
          <span className="mono text-muted">
            {drafts.length} drafts · {new Set(drafts.map((d) => d.project)).size} projects
          </span>
          {outside > 0 ? (
            <span className="mono text-xs text-muted">
              {outside} more of projects this catalog leaves out · switch the catalog to see them
            </span>
          ) : null}
          {mode === "dev" && attention > 0 ? (
            <span className="mono flex items-center gap-1 text-xs text-unresolved">
              <AlertTriangle size={12} aria-hidden /> {attention} need attention
            </span>
          ) : null}
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="label border-b border-line">
                <th className="py-2 pr-3 font-normal">show</th>
                <th className="py-2 pr-3 font-normal">project</th>
                <th className="py-2 pr-3 font-normal">branch</th>
                <th className="py-2 pr-3 font-normal">changes</th>
                <th className="py-2 pr-3 font-normal">base → tip</th>
                <th className="py-2 pr-3 font-normal">saved</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((draft) => {
                const key = draftKey(draft);
                const n = counts(draft);
                const health = draft.health;
                const running = generation && draftKey(generation.choice) === key && !generation.result && !generation.error;
                return (
                  <FragmentRows key={key}>
                    <tr className={`align-middle hover:bg-surface ${health.kind === "fresh" || mode === "static" ? "border-b border-line" : ""}`}>
                      <td className="py-2.5 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`Show ${draft.branch} in the catalog`}
                          checked={enabled.includes(key)}
                          onChange={() => toggle(key)}
                          className="accent-[var(--accent)]"
                        />
                      </td>
                      <td className="py-2.5 pr-3 text-ink">{draft.projectName}</td>
                      <td className="mono py-2.5 pr-3">
                        <Link
                          to={paths.draftCompare(draft.project, draft.branch)}
                          className={`inline-flex items-center gap-1.5 hover:text-accent hover:underline ${health.kind === "gone" && mode === "dev" ? "text-muted line-through" : "text-ink"}`}
                        >
                          <GitBranch size={13} aria-hidden className="text-muted" />
                          {draft.branch}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">
                        {draft.entities.length === 0 ? (
                          <span className="mono text-xs text-muted">no changes</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {STATES.filter((s) => n[s] > 0).map((s) => (
                              <span key={s} className={`mono tnum rounded-sm border px-1.5 py-0.5 text-[10px] ${STATE_TONE[s]}`}>
                                {n[s]} {STATE_LABEL[s].toLowerCase()}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="mono py-2.5 pr-3 text-xs text-muted">
                        {draft.base} → {draft.tip}
                      </td>
                      <td className="mono py-2.5 pr-3 text-xs text-muted">{when(draft.savedAt)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <Link
                          to={paths.draftCompare(draft.project, draft.branch)}
                          className="mono mr-2 inline-flex items-center gap-1 rounded-control border border-line px-2 py-1 text-xs text-muted hover:border-line-strong hover:text-ink"
                        >
                          <GitCompare size={12} aria-hidden /> compare
                        </Link>
                        {mode === "dev" ? (
                          <button
                            type="button"
                            onClick={() => drop(draft)}
                            aria-label={`Delete the draft of ${draft.branch}`}
                            className="mono inline-flex items-center gap-1 rounded-control border border-line px-2 py-1 text-xs text-muted hover:border-unresolved/40 hover:text-unresolved"
                          >
                            <Trash2 size={12} aria-hidden /> delete
                          </button>
                        ) : null}
                      </td>
                    </tr>

                    {mode === "dev" && health.kind !== "fresh" ? (
                      <tr className="border-b border-line">
                        <td />
                        <td colSpan={6} className="pb-2.5 pr-3">
                          {running ? (
                            <Notice tone="text-accent" icon={<LoaderCircle size={13} aria-hidden className="animate-spin" />}>
                              regenerating…
                            </Notice>
                          ) : health.kind === "stale" ? (
                            <Notice
                              tone="text-accent"
                              icon={<History size={13} aria-hidden />}
                              action={<RowButton onClick={() => regenerate(draft)} icon={<RefreshCw size={12} aria-hidden />}>regenerate</RowButton>}
                            >
                              the branch moved to {health.tip}, {health.ahead} commits this draft does not show
                            </Notice>
                          ) : health.kind === "failed" ? (
                            <>
                              <Notice
                                tone="text-unresolved"
                                icon={<AlertTriangle size={13} aria-hidden />}
                                action={
                                  <>
                                    <RowButton onClick={() => setOpenLog(openLog === key ? null : key)}>{openLog === key ? "hide log" : "show log"}</RowButton>
                                    <RowButton onClick={() => regenerate(draft)} icon={<RefreshCw size={12} aria-hidden />}>retry</RowButton>
                                  </>
                                }
                              >
                                regeneration failed {when(health.at)} at “{health.step}” · showing the draft saved {when(draft.savedAt)}
                              </Notice>
                              {openLog === key ? <Log lines={health.log} /> : null}
                            </>
                          ) : (
                            <Notice tone="text-muted" icon={<CircleSlash size={13} aria-hidden />}>
                              the branch is no longer in the repository · the saved draft stays until you delete it
                            </Notice>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
          {sorted.length === 0 ? (
            <div className="empty mt-4">
              <GitBranch size={22} aria-hidden className="mx-auto mb-2 text-muted" />
              <div className="font-medium text-ink">No saved drafts</div>
              <p className="mx-auto mt-1 max-w-prose text-muted">
                {mode === "dev" ? "Pick a project and a branch above to see what the branch adds." : "Drafts are made with portolan dev and saved into the repository."}
              </p>
            </div>
          ) : null}
        </div>

        {mode === "static" ? (
          <p className="mono mt-4 text-xs text-muted">
            A published site shows the drafts saved in the repository. Drafts are made and deleted with <span className="text-ink">portolan dev</span>.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Notice({ tone, icon, action, children }: { tone: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`mono flex flex-wrap items-center gap-2 text-xs ${tone}`}>
      {icon}
      <span>{children}</span>
      {action ? <span className="ml-auto flex gap-2">{action}</span> : null}
    </div>
  );
}

function RowButton({ onClick, icon, children }: { onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono inline-flex items-center gap-1 rounded-control border border-line px-2 py-0.5 text-xs text-muted hover:border-line-strong hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}

function Log({ lines }: { lines: string[] }) {
  return (
    <pre className="mono mt-2 max-h-48 overflow-auto rounded-control border border-line bg-canvas p-3 text-xs leading-relaxed text-muted">
      {lines.map((line, i) => (
        <div key={`${i}:${line}`} className={/^(error|branch-drafts:)/.test(line) ? "text-unresolved" : line.startsWith("$") ? "text-ink" : ""}>
          {line}
        </div>
      ))}
    </pre>
  );
}

function NewDraft() {
  const drafts = useDrafts((s) => s.drafts);
  const generation = useDrafts((s) => s.generation);
  const generate = useDrafts((s) => s.generate);
  const save = useDrafts((s) => s.save);
  const discard = useDrafts((s) => s.discard);
  const branches = useDrafts((s) => s.branches);
  const loadBranches = useDrafts((s) => s.loadBranches);
  const say = useToastStore((s) => s.say);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    loadBranches().catch((cause) => setLoadError(message(cause)));
  }, [loadBranches]);

  // Only projects some branch touches have anything to draft.
  const projects = (branches?.projects ?? []).filter((p) => branches?.branches.some((b) => b.projects.includes(p.id)));
  const [picked, setProject] = useState<string | null>(null);
  const project = picked ?? projects[0]?.id ?? "";
  const choices: BranchChoice[] = (branches?.branches ?? [])
    .filter((b) => b.projects.includes(project))
    .map((b) => ({ project, branch: b.branch, tip: short(b.tip), ahead: b.ahead }));
  const [branch, setBranch] = useState("");
  const [showLog, setShowLog] = useState(false);
  const choice = choices.find((b) => b.branch === branch) ?? choices[0];
  const existing = choice ? drafts.find((d) => draftKey(d) === draftKey(choice)) : undefined;
  const busy = Boolean(generation && !generation.result && !generation.error);
  const failed = Boolean(generation?.error);
  const projectName = (id: string) => branches?.projects.find((p) => p.id === id)?.name ?? id;
  const act = (work: Promise<void>, what: string) => work.catch((cause) => say(`Could not ${what}: ${message(cause)}`));

  return (
    <div className="mt-section rounded-control border border-line bg-surface p-4">
      <div className="flex items-center gap-2 font-medium text-ink">
        <Plus size={16} aria-hidden className="text-accent" /> New draft
      </div>
      {loadError ? (
        <div className="mono mt-3 text-xs text-unresolved">Could not list the branches: {loadError}</div>
      ) : !branches ? (
        <div className="mono mt-3 flex items-center gap-2 text-xs text-muted">
          <LoaderCircle size={13} aria-hidden className="animate-spin" /> reading the branches
        </div>
      ) : projects.length === 0 ? (
        <div className="mono mt-3 text-xs text-muted">No branch has commits {branches.main} does not have.</div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="label">project</span>
            <select
              value={project}
              disabled={busy}
              onChange={(event) => {
                setProject(event.target.value);
                setBranch("");
              }}
              className="mono rounded-control border border-line bg-canvas px-2 py-1.5 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-64 flex-col gap-1">
            <span className="label">branch</span>
            <select
              value={choice?.branch ?? ""}
              disabled={busy}
              onChange={(event) => setBranch(event.target.value)}
              className="mono rounded-control border border-line bg-canvas px-2 py-1.5 text-sm"
            >
              {choices.map((b) => (
                <option key={b.branch} value={b.branch}>
                  {b.branch} · {b.tip} · {b.ahead} ahead of {branches.main}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!choice || busy}
            onClick={() => {
              setShowLog(false);
              if (choice) void act(generate(choice), "start the generation");
            }}
            className="product-primary disabled:opacity-40"
          >
            {existing ? "Regenerate" : "Generate"}
          </button>
          {existing ? (
            <span className="mono text-xs text-muted">
              saved {when(existing.savedAt)} at {existing.tip}
              {choice && existing.tip !== choice.tip ? <span className="text-accent"> · branch moved to {choice.tip}</span> : null}
            </span>
          ) : null}
        </div>
      )}

      {generation ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mono mb-2 text-xs text-muted">
            {generation.choice.branch} · {projectName(generation.choice.project)}
          </div>
          <ol className="mono flex flex-col gap-1 text-sm">
            {generation.steps.map((step, i) => (
              <li
                key={`${i}:${step.label}`}
                className={`flex items-center gap-2 ${
                  step.state === "done" ? "text-ink" : step.state === "running" ? "text-accent" : step.state === "failed" ? "text-unresolved" : "text-muted"
                }`}
              >
                {step.state === "done" ? (
                  <Check size={13} aria-hidden className="text-declared" />
                ) : step.state === "running" ? (
                  <LoaderCircle size={13} aria-hidden className="animate-spin" />
                ) : step.state === "failed" ? (
                  <X size={13} aria-hidden />
                ) : (
                  <span className="inline-block size-[13px]" />
                )}
                {step.label}
              </li>
            ))}
          </ol>

          {failed ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-unresolved">
                  <AlertTriangle size={14} aria-hidden /> The generator failed on {generation.choice.branch}. Nothing was saved.
                </span>
                <div className="ml-auto flex gap-2">
                  <button type="button" onClick={() => setShowLog(!showLog)} className="mono rounded-control border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">
                    {showLog ? "Hide log" : "Show log"}
                  </button>
                  <button type="button" onClick={() => void act(discard(), "dismiss it")} className="mono rounded-control border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">
                    Dismiss
                  </button>
                  <button type="button" onClick={() => void act(generate(generation.choice), "start the generation")} className="product-primary">
                    Retry
                  </button>
                </div>
              </div>
              {showLog && generation.log ? <Log lines={generation.log} /> : null}
            </div>
          ) : generation.result ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <DraftChip branch={generation.result.branch} />
              <span className="text-sm text-muted">
                {generation.result.entities.length === 0
                  ? "The branch changes nothing in this project."
                  : `${generation.result.entities.length} entities differ from the base.`}
              </span>
              <span className="flex gap-1">
                {generation.result.entities.map((e) => (
                  <StateChip key={`${e.kind}:${e.id}`} state={e.state} />
                ))}
              </span>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => void act(discard(), "discard it")} className="mono rounded-control border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">
                  Discard
                </button>
                <button type="button" onClick={() => void act(save(), "save the draft")} className="product-primary">
                  Save draft
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
