import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "../app/title";
import { AdrBlockEditor } from "../components/AdrBlockEditor";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { activeCatalogProfile } from "../data";
import { createAdr, subscribeToRun } from "../lib/local-api";
import type { CreateAdrInput } from "../lib/local-api";
import { adrProjectsQuery, localKeys } from "../lib/queries";
import { paths } from "../routes";

const STATUS_OPTIONS = [
  { value: "proposed", label: "proposed", note: "Open for discussion and review" },
  { value: "accepted", label: "accepted", note: "The current architectural decision" },
  { value: "rejected", label: "rejected", note: "Considered, but deliberately not chosen" },
  { value: "deprecated", label: "deprecated", note: "Kept for history; no longer current" },
] as const;
const INITIAL_BODY = `## Context and Problem Statement

What decision needs to be made, and why now?

## Decision Drivers

- A constraint or goal that matters.

## Considered Options

1. **First option** — its relevant trade-off.
2. **Second option** — its relevant trade-off.

## Decision Outcome

Chosen option: **First option**.

### Consequences

- Good: what becomes easier or safer.
- Bad: what cost or limitation is accepted.
`;

function localDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function AdrCreate() {
  useDocumentTitle("New decision");
  const queryClient = useQueryClient();
  const state = useQuery(adrProjectsQuery());
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<CreateAdrInput["status"]>("proposed");
  const [date, setDate] = useState(localDate);
  const [body, setBody] = useState(INITIAL_BODY);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState("");

  const projects = activeCatalogProfile.projects.length
    ? (state.data?.projects ?? []).filter((candidate) => activeCatalogProfile.projects.includes(candidate.id))
    : state.data?.projects ?? [];
  const project = projects.find((candidate) => candidate.id === projectId)
    ?? projects.find((candidate) => candidate.writable)
    ?? projects[0];
  const number = project ? String(project.nextNumber).padStart(4, "0") : "0001";
  const destination = project ? `${project.directory}/${number}-${title ? "…" : "decision"}.md` : "";
  const projectOptions = useMemo(() => projects.map((candidate) => ({
    value: candidate.id,
    label: `${candidate.name} · ${candidate.root}`,
    note: candidate.writable
      ? `${candidate.scope} · ${candidate.count} existing ADR${candidate.count === 1 ? "" : "s"}`
      : candidate.reason,
  })), [projects]);

  async function save() {
    if (!state.data || !project || !project.writable || !title.trim()) return;
    setSaving(true);
    setFailure("");
    setProgress("Writing the decision beside its project…");
    try {
      const created = await createAdr({
        revision: state.data.revision,
        projectId: project.id,
        number: project.nextNumber,
        title: title.trim(),
        status,
        date,
        body,
      });
      await queryClient.invalidateQueries({ queryKey: localKeys.adrProjects });
      if (!created.run) {
        setProgress(`Written to ${created.path}.`);
        setFailure(created.generationError ? `Catalog generation did not start: ${created.generationError}` : "Catalog generation did not start.");
        setSaving(false);
        return;
      }
      setProgress("ADR written. Rebuilding the catalog…");
      subscribeToRun(created.run.runId, (event) => {
        if (event.type !== "process-finished") return;
        if (event.status === "ok") {
          const target = `${import.meta.env.BASE_URL}${paths.adr(created.slug).replace(/^\//, "")}?created=${Date.now()}`;
          window.location.assign(target);
        } else {
          setFailure(`The ADR is in ${created.path}, but catalog generation ${event.status}.`);
          setProgress("");
          setSaving(false);
        }
      }, () => {});
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setProgress("");
      setSaving(false);
    }
  }

  if (state.isLoading) {
    return <div className="h-full overflow-y-auto p-gutter text-muted">Reading ADR locations from the dev server…</div>;
  }

  if (state.isError) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="mx-auto max-w-prose rounded-card border border-line bg-canvas p-card shadow-xs">
          <div className="label">local authoring</div>
          <h1 className="mt-1 text-lg font-semibold">Start Portolan in dev mode to write an ADR</h1>
          <p className="mt-2 text-muted">The editor writes into a project repository, so it is deliberately unavailable in a static or deployed catalog.</p>
          <Link to={paths.adrs()} className="tbtn mt-4"><ArrowLeft size={14} /> Back to decisions</Link>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="empty">Connect a project before writing a project decision.</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line px-gutter py-3">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3">
          <Link to={paths.adrs()} className="tbtn h-8 w-8 justify-center p-0" aria-label="Back to decisions"><ArrowLeft size={14} /></Link>
          <div className="min-w-0">
            <div className="label">new decision · {project.name}</div>
            <h1 className="truncate text-md font-semibold">Write an ADR</h1>
          </div>
          <span className="chip mono border-line-strong">ADR-{number}</span>
          <button
            type="button"
            className="product-primary ml-auto"
            disabled={saving || !project.writable || !title.trim()}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle size={15} className="animate-spin" /> : <FilePlus2 size={15} />}
            {saving ? "Saving…" : "Save & rebuild"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] p-gutter">
        <section className="min-w-0 overflow-hidden rounded-card border border-line bg-canvas shadow-xs">
          <div className="border-b border-line bg-surface px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(15rem,1.5fr)_9rem_11rem]">
              <label>
                <span className="label mb-1 block">project</span>
                <Select
                  value={project.id}
                  options={projectOptions}
                  onChange={setProjectId}
                  label="Project"
                  className="w-full"
                  menuWidth={360}
                  disabled={saving}
                  appearance="detail"
                />
              </label>
              <label>
                <span className="label mb-1 block">status</span>
                <Select
                  value={status}
                  options={STATUS_OPTIONS}
                  onChange={(value) => setStatus(value as CreateAdrInput["status"])}
                  label="ADR status"
                  className="w-full"
                  menuWidth={320}
                  disabled={saving}
                  appearance="detail"
                />
              </label>
              <label>
                <span className="label mb-1 block">decision date</span>
                <DatePicker value={date} onChange={setDate} label="Decision date" disabled={saving} />
              </label>
            </div>
            <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-faint">
              <span>scope · <span className="text-muted">{project.scope}</span></span>
              <span className="min-w-0 truncate">source · <span className="text-muted">{destination}</span></span>
              <span>{project.count} existing</span>
              {!project.configured ? <span className="text-declared">extractor will be added</span> : null}
            </div>
            {!project.writable ? <p className="status-unresolved mt-2 rounded-control px-3 py-2">{project.reason}</p> : null}
          </div>

          <div className="border-b border-line px-4 py-3">
            <label>
              <span className="label mb-1 block">decision title</span>
              <input
                className="w-full bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-faint"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={180}
                placeholder="The decision in one sentence"
                autoFocus
                disabled={saving}
              />
            </label>
          </div>

          <AdrBlockEditor disabled={saving} onChange={setBody} />

          {failure || progress ? (
            <div className="border-t border-line px-card py-3">
              {failure ? <p className="text-unresolved">{failure}</p> : null}
              {progress ? <p className="text-muted">{progress}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
