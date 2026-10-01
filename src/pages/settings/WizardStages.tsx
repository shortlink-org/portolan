import type { Dispatch, SetStateAction } from "react";
import { Check, CircleAlert, FolderGit2, LoaderCircle } from "lucide-react";
import { catalog } from "../../data";
import { plural } from "../../lib/format";
import type { SetupProject } from "../../lib/setup-info";
import type { Discovery, LocalApiError, ProjectDraft, ProjectPlan, RunEvent } from "../../lib/local-api";
import { Empty } from "../../components/PageHeader";
import { CatIllustration } from "../../components/CatIllustration";
import { CommitLink } from "../../components/CommitLink";
import type { ProjectSource } from "./setup";
import { CAPABILITIES } from "./capabilities";
import { FIELD, Field } from "./Field";
import { WarningPanel } from "./WarningPanel";

const PROJECT_PRESETS: Array<{ label: string; kind: NonNullable<ProjectDraft["componentKind"]>; summary: string }> = [
  { label: "Service", kind: "service", summary: "A deployable business capability." },
  { label: "Web app", kind: "webapp", summary: "A browser-facing application." },
  { label: "Worker", kind: "worker", summary: "A long-running background consumer." },
  { label: "CLI", kind: "cli", summary: "A command-line application." },
  { label: "Library", kind: "library", summary: "Reusable code, not deployed alone." },
];

type TrialReady = Extract<RunEvent, { type: "project-trial-ready" }>;
type ProcessFinished = Extract<RunEvent, { type: "process-finished" }>;
type StepStarted = Extract<RunEvent, { type: "step-started" }>;
type StepFinished = Extract<RunEvent, { type: "step-finished" }>;
type LogEvent = Extract<RunEvent, { type: "log" }>;

export function SourceStage({
  repositoryError,
  repository,
  gitRef: ref,
  sourcePath,
  path,
  source,
  resumed,
  clearRepositoryFailure,
  startOver,
  selectSource,
  setPath,
  setRepository,
  setRef,
  setSourcePath,
}: {
  repositoryError: LocalApiError | null;
  repository: string;
  gitRef: string;
  sourcePath: string;
  path: string;
  source: ProjectSource;
  resumed: boolean;
  clearRepositoryFailure: () => void;
  startOver: () => void;
  selectSource: (next: "local" | "external") => void;
  setPath: (value: string) => void;
  setRepository: (value: string) => void;
  setRef: (value: string) => void;
  setSourcePath: (value: string) => void;
}) {
  return repositoryError ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface px-3 py-2">
      <div className="min-w-0">
        <div className="mono truncate text-ink">{repository}</div>
        <div className="mono mt-0.5 text-muted">{ref || "HEAD"}{sourcePath ? ` · ${sourcePath}` : ""}</div>
      </div>
      <button type="button" className="tbtn" onClick={clearRepositoryFailure}>Edit source</button>
    </div>
  ) : (
    <div className="space-y-5">
      {resumed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-accent bg-surface px-3 py-2">
          <span className="text-muted"><span className="font-medium text-ink">Draft restored.</span> Continue with the source from your last session.</span>
          <button type="button" className="tbtn" onClick={startOver}>Start over</button>
        </div>
      ) : null}
      <div className="seg inline-flex" role="group" aria-label="Project source">
        <button type="button" className={source === "local" ? "is-on" : ""} aria-pressed={source === "local"} onClick={() => selectSource("local")}>
          local directory
        </button>
        <button type="button" className={source === "external" ? "is-on" : ""} aria-pressed={source === "external"} onClick={() => selectSource("external")}>
          external repository
        </button>
      </div>
      <p className="text-muted">
        Detection reads project files but does not execute project code. External repositories are pinned and vendored through the built-in git fetcher.
      </p>
      <div className="rounded-control border border-line bg-surface px-3 py-2 text-muted">
        <span className="font-medium text-ink">Tip:</span> local paths are relative to this workspace. To connect a separate repository such as <span className="mono text-ink">aviaadmin</span>, choose external repository.
      </div>
      {source === "local" ? (
        <>
          <Field label="local path" value={path} onChange={setPath} placeholder="services/billing" required />
          <Field
            label="repository URL · optional"
            value={repository}
            onChange={(value) => { setRepository(value); clearRepositoryFailure(); }}
            placeholder="https://github.com/acme/billing"
          />
        </>
      ) : (
        <>
          <Field
            label="repository URL"
            value={repository}
            onChange={(value) => { setRepository(value); clearRepositoryFailure(); }}
            placeholder="https://github.com/acme/platform"
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="branch, tag or commit"
              value={ref}
              onChange={(value) => { setRef(value); clearRepositoryFailure(); }}
              placeholder="main"
            />
            <Field
              label="component path · optional"
              value={sourcePath}
              onChange={(value) => { setSourcePath(value); clearRepositoryFailure(); }}
              placeholder="services/billing"
            />
          </div>
        </>
      )}
    </div>
  );
}

export function ScopeStage({
  scopeDiscovery,
  selectedComponents,
  setSelectedComponents,
  busy,
}: {
  scopeDiscovery: Discovery;
  selectedComponents: string[];
  setSelectedComponents: Dispatch<SetStateAction<string[]>>;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-ink">
            Portolan found {scopeDiscovery.components.length} possible {plural(scopeDiscovery.components.length, "component")}.
          </p>
          <p className="mt-1 text-muted">
            Select one or several modules. Each selected component gets its own scoped discovery and trial before it is added.
            In a batch, confirmed components are applied one at a time, so you can stop between them.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="tbtn" onClick={() => setSelectedComponents(scopeDiscovery.components.map((component) => component.path))}>
            Select all
          </button>
          <button type="button" className="tbtn" onClick={() => setSelectedComponents([])} disabled={!selectedComponents.length}>
            Clear
          </button>
        </div>
      </div>
      <div className="grid gap-2">
        {scopeDiscovery.components.map((component) => {
          const selected = selectedComponents.includes(component.path);
          return (
            <button
              type="button"
              key={component.path}
              aria-pressed={selected}
              onClick={() => setSelectedComponents((current) => selected ? current.filter((item) => item !== component.path) : [...current, component.path])}
              disabled={busy}
              className={`flex items-center gap-3 rounded-control border px-3 py-3 text-left transition-colors hover:border-accent hover:bg-surface ${selected ? "border-accent bg-surface" : "border-line"}`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-control ${selected ? "bg-accent text-canvas" : "bg-surface text-muted"}`}>
                {selected ? <Check size={17} /> : <FolderGit2 size={17} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{component.name}</span>
                <span className="mono mt-0.5 block truncate text-muted">{component.path === "." ? "repository root" : component.path}</span>
              </span>
              <span className="flex flex-wrap justify-end gap-1">
                {component.technologies.map((technology) => <span key={technology} className="chip status-declared">{technology}</span>)}
              </span>
            </button>
          );
        })}
      </div>
      {scopeDiscovery.componentsTruncated ? (
        <p className="text-declared">
          Showing the first {scopeDiscovery.components.length} component roots. Narrow the source path to inspect the rest.
        </p>
      ) : null}
    </div>
  );
}

export function ConfigureStage({
  discovery,
  draft,
  setDraft,
  starter,
  splitsDeployables,
  confirmedDeployables,
}: {
  discovery: Discovery;
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft | null>>;
  starter: SetupProject | undefined;
  splitsDeployables: boolean;
  confirmedDeployables: Discovery["deployables"];
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-control border border-line bg-surface px-3 py-2 text-muted">
        <span className="mono text-ink">
          {draft.source === "external"
            ? `${draft.repository}@${draft.commit.slice(0, 7)}${draft.sourcePath ? `/${draft.sourcePath}` : ""}`
            : discovery.root}
        </span> · scanned {discovery.filesScanned} files{discovery.truncated ? " (limit reached)" : ""}
      </div>
      {starter ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-control border border-accent bg-surface px-3 py-3">
          <input
            className="mt-1"
            type="checkbox"
            checked={draft.replaceStarter ?? false}
            onChange={(event) => setDraft({ ...draft, replaceStarter: event.target.checked })}
          />
          <span>
            <span className="font-medium text-ink">Replace {starter.name} starter after the trial succeeds</span>
            <span className="mt-0.5 block text-muted">
              The new project and starter removal are written together, so a failed trial leaves the workspace unchanged.
            </span>
          </span>
        </label>
      ) : null}
      {splitsDeployables ? (
        <section>
          <div className="label mb-2">detected deployables</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {confirmedDeployables.map((component) => (
              <div key={component.slug} className="rounded-control border border-accent bg-surface px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{component.name}</span>
                  <span className="chip status-verified">service</span>
                </div>
                <span className="mono mt-1 block text-muted">{component.path}</span>
                <span className="mono mt-0.5 block truncate text-faint" title={component.evidence.join(", ")}>
                  confirmed by {component.evidence.length} source/build files
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-muted">
            These entrypoints share one repository root but will be catalogued as separate runtime components.
          </p>
        </section>
      ) : (
        <section>
          <div className="label mb-2">component preset</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {PROJECT_PRESETS.map((preset) => (
              <button
                key={preset.kind}
                type="button"
                className={`rounded-control border px-3 py-2 text-left transition-colors ${draft.componentKind === preset.kind ? "border-accent bg-surface" : "border-line hover:bg-surface"}`}
                aria-pressed={draft.componentKind === preset.kind}
                onClick={() => setDraft({ ...draft, componentKind: preset.kind, ...(preset.kind === "service" ? { groupKind: "bounded-context" as const } : {}) })}
              >
                <span className="font-medium text-ink">{preset.label}</span>
                <span className="mt-0.5 block text-muted">{preset.summary}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="label mb-2">project identity</div>
        <div className="grid gap-4 rounded-control border border-line p-4 sm:grid-cols-2">
          <Field label="display name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required />
          <Field label="stable project id" value={draft.id} onChange={(id) => setDraft({ ...draft, id })} required />
          <p className="text-muted sm:col-span-2">
            The id connects this project to its extraction steps. Keep it stable even if the display name changes.
          </p>
        </div>
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label">architecture placement</div>
          <span className="chip status-declared">
            {draft.group || "group"} → {splitsDeployables ? `${confirmedDeployables.length} components` : draft.component || "component"}
          </span>
        </div>
        <div className="grid gap-4 rounded-control border border-line p-4 sm:grid-cols-2">
          {catalog.contexts.length ? (
            <label className="block sm:col-span-2">
              <span className="label mb-1.5 block">start from</span>
              <select
                className={FIELD}
                value={catalog.contexts.some((context) => context.id === draft.group) ? draft.group : "__new__"}
                onChange={(event) => {
                  const existing = catalog.contexts.find((context) => context.id === event.target.value);
                  setDraft(existing
                    ? { ...draft, group: existing.id, contextName: existing.name, contextSummary: existing.summary, classification: existing.classification || "supporting", groupKind: existing.kind || "bounded-context" }
                    : { ...draft, group: draft.id, contextName: draft.name, contextSummary: "", classification: "supporting", groupKind: "bounded-context" });
                }}
              >
                <option value="__new__">Create a new context or group</option>
                {catalog.contexts.map((context) => <option key={context.id} value={context.id}>Use {context.name} ({context.id})</option>)}
              </select>
            </label>
          ) : null}
          <Field label="bounded context / group" value={draft.group} onChange={(group) => setDraft({ ...draft, group })} placeholder="avia" />
          <Field label="context name" value={draft.contextName ?? ""} onChange={(contextName) => setDraft({ ...draft, contextName })} placeholder="Aviation" />
          <label className="block sm:col-span-2">
            <span className="label mb-1.5 block">responsibility · optional</span>
            <textarea
              className={`${FIELD} min-h-20 resize-y`}
              value={draft.contextSummary ?? ""}
              onChange={(event) => setDraft({ ...draft, contextSummary: event.target.value })}
              placeholder="What business decisions and language belong inside this boundary?"
            />
          </label>
          {splitsDeployables ? null : (
            <>
              <Field label="component slug" value={draft.component} onChange={(component) => setDraft({ ...draft, component })} placeholder="aviaadmin" />
              <label className="block">
                <span className="label mb-1.5 block">component kind</span>
                <select
                  className={FIELD}
                  value={draft.componentKind ?? "application"}
                  onChange={(event) => setDraft({ ...draft, componentKind: event.target.value as ProjectDraft["componentKind"] })}
                >
                  <option value="service">service</option>
                  <option value="application">application</option>
                  <option value="webapp">web app</option>
                  <option value="worker">worker</option>
                  <option value="job">job</option>
                  <option value="function">function</option>
                  <option value="cli">CLI</option>
                  <option value="library">library</option>
                  <option value="data-pipeline">data pipeline</option>
                </select>
              </label>
            </>
          )}
          <label className="block">
            <span className="label mb-1.5 block">group kind</span>
            <select
              className={FIELD}
              value={draft.groupKind ?? "system"}
              onChange={(event) => setDraft({ ...draft, groupKind: event.target.value as ProjectDraft["groupKind"] })}
            >
              <option value="bounded-context">bounded context</option>
              <option value="system">system</option>
              <option value="product">product</option>
              <option value="team">team</option>
              <option value="namespace">namespace</option>
            </select>
          </label>
          {draft.groupKind === "bounded-context" ? (
            <label className="block">
              <span className="label mb-1.5 block">classification</span>
              <select
                className={FIELD}
                value={draft.classification ?? "supporting"}
                onChange={(event) => setDraft({ ...draft, classification: event.target.value as ProjectDraft["classification"] })}
              >
                <option value="core">core</option>
                <option value="supporting">supporting</option>
                <option value="generic">generic</option>
              </select>
            </label>
          ) : null}
          <p className="rounded-control bg-surface px-3 py-2 text-muted sm:col-span-2">
            <span className="font-medium text-ink">Tip:</span> {draft.groupKind === "bounded-context"
              ? "use one bounded context for components that share the same business language and rules — it does not have to match the folder tree."
              : "choose bounded context when this group owns a distinct business language; use system for a primarily technical boundary."}
          </p>
        </div>
      </section>
      <div>
        <div className="label mb-2">detected capabilities</div>
        {discovery.detections.length ? (
          <div className="grid gap-2">
            {discovery.detections.map((item) => {
              const checked = draft.plugins.includes(item.plugin);
              const capability = CAPABILITIES[item.plugin] ?? { title: item.plugin, summary: "Catalog facts extracted from project files." };
              return (
                <label
                  key={item.plugin}
                  className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-3 transition-colors ${checked ? "border-accent bg-surface" : "border-line hover:bg-surface"}`}
                >
                  <input
                    aria-label={`Toggle ${capability.title}`}
                    className="mt-1"
                    type="checkbox"
                    checked={checked}
                    onChange={() => setDraft({ ...draft, plugins: checked ? draft.plugins.filter((name) => name !== item.plugin) : [...draft.plugins, item.plugin] })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{capability.title}</span>
                      <span className={`chip ${item.confidence === "high" ? "status-verified" : "status-declared"}`}>{item.confidence} confidence</span>
                      {item.candidates.length > 1 ? <span className="chip status-declared">{item.candidates.length} candidates</span> : null}
                    </span>
                    <span className="mt-0.5 block text-muted">{capability.summary}</span>
                    <span className="mono mt-1 block truncate text-faint" title={item.evidence}>evidence · {item.evidence}</span>
                    {item.preview?.length ? (
                      <span className="mt-2 grid gap-1.5">
                        {item.preview.slice(0, 3).map((preview) => (
                          <span key={preview.file} className="block rounded-control border border-line bg-canvas px-2 py-1.5">
                            <span className="mono block truncate text-faint" title={preview.file}>{preview.file}</span>
                            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted">
                              {Object.entries(preview.fields).map(([field, value]) => (
                                <span key={field}><span className="text-faint">{field}</span> · <span className="text-ink">{value}</span></span>
                              ))}
                            </span>
                          </span>
                        ))}
                        {item.preview.length > 3 ? <span className="text-faint">+ {item.preview.length - 3} more recognized records</span> : null}
                      </span>
                    ) : null}
                    <span className="mono mt-0.5 block text-faint">extractor · {item.plugin}</span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <Empty>no supported project signals found</Empty>
        )}
      </div>
    </div>
  );
}

export function TrialStage({
  plan,
  trial,
  finished,
  activeStep,
  completedSteps,
  logs,
  percent,
  totalSteps,
  quality,
  trialDiagnostics,
}: {
  plan: ProjectPlan;
  trial: TrialReady | undefined;
  finished: ProcessFinished | undefined;
  activeStep: StepStarted | undefined;
  completedSteps: StepFinished[];
  logs: LogEvent[];
  percent: number;
  totalSteps: number;
  quality: Array<{ label: string; done: boolean }>;
  trialDiagnostics: TrialReady["diagnostics"];
}) {
  return (
    <div className="space-y-5">
      <div className={`rounded-control border px-3 py-3 ${trial ? "border-verified bg-surface" : finished?.status === "failed" ? "border-unresolved" : "border-line bg-surface"}`}>
        <div className={trial ? "grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_120px]" : ""}>
          <div className="flex items-start gap-3">
            {trial
              ? <Check size={18} className="mt-0.5 shrink-0 text-verified" />
              : finished?.status === "failed"
                ? <CircleAlert size={18} className="mt-0.5 shrink-0 text-unresolved" />
                : <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />}
            <div>
              <div className="font-medium text-ink">
                {trial
                  ? "Extraction succeeded — repository unchanged"
                  : finished?.status === "failed"
                    ? "Trial extraction failed"
                    : activeStep
                      ? `Running ${activeStep.plugin}`
                      : "Creating an isolated workspace…"}
              </div>
              <p className="mt-0.5 text-muted">
                {trial
                  ? "These results came from real catalog fragments. Apply is now safe to continue."
                  : "Portolan is running the selected extractors without writing to portolan.json or your project."}
              </p>
            </div>
          </div>
          {trial ? <CatIllustration scene="trial" className="cat-trial-illustration" /> : null}
        </div>
        {trial?.previewUrl ? (
          <a className="product-primary mt-3 inline-flex" href={trial.previewUrl} target="_blank" rel="noreferrer">
            Open catalog preview ↗
          </a>
        ) : null}
        {trial?.previewError ? (
          <p className="mt-2 text-declared">The extraction is valid, but the temporary site could not start: {trial.previewError}</p>
        ) : null}
        {!finished ? (
          <>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <div className="mono mt-1 text-right text-muted">{completedSteps.length} / {totalSteps || "?"} steps</div>
          </>
        ) : null}
      </div>
      {trial ? (
        <section>
          <div className="label mb-2">what Portolan found</div>
          {trial.facts.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {trial.facts.map((fact) => (
                <div key={fact.key} className="rounded-control border border-line bg-canvas px-3 py-2">
                  <div className="tnum text-lg font-semibold text-ink">{fact.count}</div>
                  <div className="text-muted">{fact.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-control border border-line bg-surface px-3 py-3 text-muted">
              Only component metadata was found. You can add APIs, domain models and stores later without re-adding the project.
            </div>
          )}
        </section>
      ) : null}
      {trial ? (
        <section>
          <div className="label mb-2">catalog readiness</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {quality.map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-control border border-line px-3 py-2">
                <span className={`flex size-5 items-center justify-center rounded-full ${item.done ? "bg-verified text-canvas" : "bg-surface text-declared"}`}>
                  {item.done ? <Check size={12} aria-hidden /> : <CircleAlert size={12} aria-hidden />}
                </span>
                <span className={item.done ? "text-ink" : "text-muted"}>{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <div className="label mb-2">extractor results</div>
        <div className="divide-y divide-line rounded-control border border-line">
          {(trial?.steps ?? completedSteps).map((step) => (
            <div key={`${step.plugin}:${"ordinal" in step ? step.ordinal : "trial"}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_auto_auto]">
              <span>
                <span className="font-medium text-ink">{CAPABILITIES[step.plugin]?.title ?? step.plugin}</span>
                <span className="mono ml-2 text-faint">{step.plugin}</span>
                {step.message ? <span className="mt-1 block text-unresolved">{step.message}</span> : null}
              </span>
              <span className="mono text-muted">{step.fileCount} {plural(step.fileCount, "file")}</span>
              <span className={`chip ${step.status === "failed" ? "status-unresolved" : "status-verified"}`}>{step.status === "failed" ? "failed" : "read"}</span>
            </div>
          ))}
        </div>
      </section>
      {trialDiagnostics.length ? (
        <section>
          <div className="label mb-2">diagnostics · {trialDiagnostics.length}</div>
          <WarningPanel diagnostics={trialDiagnostics} />
        </section>
      ) : null}
      {finished?.status === "failed" && logs.length ? (
        <details>
          <summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary>
          <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">
            {logs.map((event) => event.message).join("\n")}
          </pre>
        </details>
      ) : null}
      {trial ? (
        <div>
          <div className="label mb-2">changes after apply</div>
          <dl className="mono grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-muted">
            <dt>project</dt>
            <dd className="text-ink">{plan.project.id}</dd>
            {plan.fetch ? (
              <>
                <dt>pin</dt>
                <dd className="truncate text-ink"><CommitLink commit={plan.fetch.commit} repository={plan.fetch.repo} length={12} /></dd>
              </>
            ) : null}
            <dt>source</dt>
            <dd className="truncate text-ink">{plan.source}</dd>
            <dt>pipeline</dt>
            <dd className="text-ink">{plan.steps.length + (plan.fetch ? 1 : 0)} {plural(plan.steps.length + (plan.fetch ? 1 : 0), "extract step")}</dd>
            <dt>fragments</dt>
            <dd className="text-ink">{trial.generatedFiles} generated</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
