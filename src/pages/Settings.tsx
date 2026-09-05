import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  FolderGit2,
  LoaderCircle,
  Moon,
  Play,
  Plus,
  Rows2,
  Rows4,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { catalog, catalogSources } from "../data";
import { useDensity } from "../app/density";
import { useTheme } from "../app/theme";
import { useToastStore } from "../app/toast";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { setupInfo as staticSetupInfo } from "../lib/setup-info";
import type {
  SetupInfo,
  SetupPhase,
  SetupPlugin,
  SetupProject,
  SetupRunStep,
  SetupRunStepStatus,
} from "../lib/setup-info";
import {
  addProject,
  cancelGeneration,
  discover,
  localStatus,
  previewProject,
  startGeneration,
  subscribeToRun,
} from "../lib/local-api";
import type { Discovery, ProjectDraft, ProjectPlan, RunEvent } from "../lib/local-api";
import { sourceHref, treeHref } from "../lib/source-link";
import { paths } from "../routes";
import { Empty, SectionTitle } from "../components/PageHeader";
import { Modal } from "../components/Overlay";

type Health = "healthy" | "changed" | "failed" | "unchecked";

const SetupContext = createContext<SetupInfo>(staticSetupInfo);
const useSetup = () => useContext(SetupContext);

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-canvas px-3 py-2 shadow-xs">
      <span className="tnum text-lg font-semibold text-ink">{value}</span>
      <span className="mono ml-2 text-muted">{plural(value, label)}</span>
    </div>
  );
}

function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
}

function healthFor(steps: SetupRunStep[], expected: number, setupInfo: SetupInfo): Health {
  if (
    expected === 0 ||
    setupInfo.reportStale ||
    !setupInfo.run ||
    setupInfo.run.status === "running" ||
    steps.length < expected
  ) {
    return "unchecked";
  }
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "drifted")) return "changed";
  return "healthy";
}

const HEALTH_LABEL: Record<Health, string> = {
  healthy: "healthy",
  changed: "out of date",
  failed: "failed",
  unchecked: "not checked",
};

function HealthBadge({ health }: { health: Health }) {
  const style =
    health === "healthy"
      ? "status-verified"
      : health === "unchecked"
        ? "text-muted"
        : health === "changed"
          ? "status-declared"
          : "status-unresolved";
  return <span className={`chip ${style}`}>{HEALTH_LABEL[health]}</span>;
}

function StepStatus({ status }: { status: SetupRunStepStatus }) {
  const health: Health =
    status === "failed"
      ? "failed"
      : status === "drifted"
        ? "changed"
        : "healthy";
  return (
    <span className={`chip ${health === "healthy" ? "status-verified" : health === "changed" ? "status-declared" : "status-unresolved"}`}>
      {status}
    </span>
  );
}

function BuildHealth() {
  const setupInfo = useSetup();
  const run = setupInfo.run;
  const stale = setupInfo.reportStale;
  const health: Health =
    stale || !run || run.status === "running"
      ? "unchecked"
      : run.status === "failed"
        ? "failed"
        : run.steps.length !== setupInfo.steps.length
          ? "unchecked"
          : run.status === "drifted"
            ? "changed"
            : "healthy";
  const finished = run?.finishedAt || run?.startedAt || "";
  const completed = run?.steps.filter((step) => step.status !== "failed").length ?? 0;

  return (
    <section className="mt-4 rounded-card border border-line bg-surface px-4 py-3 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {health === "failed" ? (
            <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-unresolved" />
          ) : (
            <Check
              size={18}
              aria-hidden
              className={`mt-0.5 shrink-0 ${health === "healthy" ? "text-verified" : "text-muted"}`}
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Build health</span>
              <HealthBadge health={health} />
            </div>
            <p className="mt-0.5 text-muted">
              {stale
                ? "Configuration changed since the last generator run."
                : !run
                  ? "No local generator result is available for this build."
                  : health === "unchecked"
                    ? "The recorded generator run did not complete every declared step."
                    : health === "healthy"
                    ? "Every recorded pipeline step completed and generated output is current."
                    : health === "changed"
                      ? "The check found generated output that needs to be refreshed."
                      : "The generator stopped before the pipeline completed."}
            </p>
          </div>
        </div>
        {/* Three readings of one run, set as a strip rather than a pair of
            right-aligned columns: the labels are short and the values are not,
            and ranging both right left a ragged channel down the middle that
            read as a mistake. Label over value, ranged left, is how the metrics
            under this block are already set. */}
        {run ? (
          <dl className="flex shrink-0 gap-x-6 gap-y-2 max-sm:flex-wrap">
            <div>
              <dt className="label">steps</dt>
              <dd className="mono tnum mt-0.5 text-ink">{completed}/{setupInfo.steps.length}</dd>
            </div>
            <div>
              <dt className="label">run</dt>
              <dd className="mono mt-0.5 text-ink">{run.mode} · {duration(run.durationMs)}</dd>
            </div>
            {finished ? (
              <div>
                <dt className="label">finished</dt>
                <dd className="mono mt-0.5 text-ink" title={absoluteTime(finished)}>{relativeTime(finished)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <code className="mono shrink-0 rounded-control border border-line bg-canvas px-2 py-1 text-ink">
            npm run gen:check
          </code>
        )}
      </div>
    </section>
  );
}

function projectHref(project: SetupProject): string | null {
  const context = catalog.contexts.find((item) => item.id === project.context);
  if (!context) return null;
  const service = context.services.find(
    (item) =>
      item.slug === project.service ||
      item.id === project.service ||
      item.id === `${context.id}.${project.service}`,
  );
  return service ? paths.service(context.id, service.slug) : paths.context(context.id);
}

function forge(project: SetupProject): { href: string; title: string } | null {
  if (project.repository) {
    return { href: project.repository, title: "Open the project's repository" };
  }
  const tree = treeHref(project.root, null);
  return tree
    ? { href: tree, title: "Open the project's directory at the built commit" }
    : null;
}

function FileLink({ path }: { path: string }) {
  const href = sourceHref(path, null);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-control text-accent hover:underline">
      {path} ↗
    </a>
  ) : (
    <span title={path}>{path}</span>
  );
}

function PipelineSteps({ steps }: { steps: SetupRunStep[] }) {
  if (steps.length === 0) {
    return <p className="mono text-muted">No result recorded for these steps.</p>;
  }
  return (
    <div className="divide-y divide-line rounded-control border border-line">
      {steps.map((step) => (
        <div key={step.ordinal} className="grid gap-2 px-3 py-2 sm:grid-cols-[5rem_minmax(7rem,1fr)_auto_auto] sm:items-center">
          <span className="mono text-muted">{step.phase}</span>
          <span className="mono truncate text-ink" title={step.plugin}>{step.plugin}</span>
          <span className="mono text-muted">{step.fileCount} {plural(step.fileCount, "file")}</span>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="mono text-muted">{duration(step.durationMs)}</span>
            <StepStatus status={step.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: SetupProject }) {
  const setupInfo = useSetup();
  const declared = setupInfo.steps.filter((step) => step.projectId === project.id);
  const runSteps = setupInfo.run?.steps.filter((step) => step.projectId === project.id) ?? [];
  const pluginNames = [...new Set(declared.map((step) => step.plugin))];
  const sources = catalogSources.filter(
    (source) => source.path === project.root || source.path.startsWith(`${project.root}/`),
  );
  const outputs = [...new Set(runSteps.flatMap((step) => step.files))];
  const commits = [...new Set(sources.map((source) => source.commit).filter(Boolean))];
  const href = projectHref(project);
  const sourceLink = forge(project);
  const health = healthFor(runSteps, declared.length, setupInfo);
  const title = <span className="font-semibold text-ink">{project.name}</span>;

  return (
    <article id={`project-${project.id}`} className="scroll-mt-4 rounded-card border border-line bg-canvas p-card shadow-xs">
      <div className="flex items-start gap-3">
        <FolderGit2 size={18} aria-hidden className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {href ? <Link to={href} className="rounded-control hover:underline">{title}</Link> : title}
            <HealthBadge health={health} />
          </div>
          <div className="mono mt-0.5 flex items-center gap-2 text-muted">
            <span className="truncate" title={project.root}>{project.root}</span>
            {sourceLink ? (
              <a href={sourceLink.href} target="_blank" rel="noreferrer" className="shrink-0 rounded-control text-accent hover:underline" title={sourceLink.title}>
                source ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <dl className="mono mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted">
        <dt>scope</dt><dd className="truncate text-ink">{[project.context, project.service].filter(Boolean).join(" · ") || "estate"}</dd>
        <dt>pipeline</dt><dd className="text-ink">{declared.length} {plural(declared.length, "step")}</dd>
        <dt>fragments</dt><dd className="text-ink">{sources.length}</dd>
        <dt>commit</dt><dd className="truncate text-ink" title={commits.join(", ")}>{commits.length === 0 ? "not stamped" : commits.length === 1 ? commits[0] : `${commits.length} source commits`}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Active plugins">
        {pluginNames.map((name) => <a key={name} href={`#plugin-${name}`} className="chip border-line-strong hover:border-accent hover:text-accent">{name}</a>)}
      </div>

      <details className="group mt-4 border-t border-line pt-3">
        {/* Clickable, so it answers the pointer. The plugin rows below tint
            their whole row; a disclosure inside a card has no edges to tint, so
            it says the same thing in the colour a link uses. */}
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-control font-medium text-ink transition-colors group-hover:text-accent">
          Pipeline and sources
          <ChevronDown size={16} aria-hidden className="shrink-0 text-muted transition-transform group-hover:text-accent group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-4">
          <PipelineSteps steps={runSteps} />
          <div>
            <div className="label mb-2">catalog sources</div>
            {sources.length > 0 ? <ul className="mono space-y-1 text-muted">{sources.map((source) => <li key={source.path} className="truncate"><FileLink path={source.path} /></li>)}</ul> : <p className="mono text-muted">No catalog fragments found under this root.</p>}
          </div>
          {outputs.length > 0 ? (
            <div>
              <div className="label mb-2">generated outputs</div>
              <ul className="mono space-y-1 text-muted">{outputs.map((output) => <li key={output} className="truncate"><FileLink path={output} /></li>)}</ul>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

const PHASE_LABEL: Record<SetupPhase, string> = { extract: "extract", verify: "verify", generate: "generate" };

/* Fifteen of sixteen plugins run as a host process, so spelling it out on
   every row was fifteen repetitions of the word to make the one that differs
   findable. The icon carries it on the row and the legend under the list says
   what the two mean; the name stays for the reader who opens a row. */
function Runtime({ plugin, icon = false }: { plugin: SetupPlugin; icon?: boolean }) {
  const [Icon, tone, name] =
    plugin.runtime === "wasm"
      ? ([ShieldCheck, "text-verified", "WASM sandbox"] as const)
      : ([Terminal, "text-declared", "host process"] as const);
  return icon ? (
    <span className={tone} title={name}>
      <Icon size={14} aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1.5 ${tone}`}><Icon size={14} aria-hidden /> {name}</span>
  );
}

/* Health is the same word on nearly every row too. A dot states it without
   spending a column on it, and the badge comes back the moment it is not
   "healthy" - which is the only time anyone is reading this column. */
function HealthDot({ health }: { health: Health }) {
  const tone =
    health === "healthy"
      ? "bg-verified"
      : health === "changed"
        ? "bg-declared"
        : health === "failed"
          ? "bg-unresolved"
          : "bg-line-strong";
  return (
    <span className={`size-1.5 shrink-0 rounded-full ${tone}`} title={HEALTH_LABEL[health]}>
      <span className="sr-only">{HEALTH_LABEL[health]}</span>
    </span>
  );
}

const PHASE_ORDER: SetupPhase[] = ["extract", "verify", "generate"];

/**
 * The sixteen plugins, grouped by the phase they run in.
 *
 * It was a five-column table, and four of the columns said the same thing on
 * nearly every row: the phase (thirteen say "extract"), the runtime (fifteen
 * say "host process"), the status (sixteen say "healthy"). A table is for
 * columns that differ. The phase became the group it sorts into, the runtime
 * and the status became a mark, and what is left on the row is the name and
 * the one number that varies. The detail every row could open is unchanged.
 */
function PluginsList() {
  const setupInfo = useSetup();
  if (setupInfo.plugins.length === 0) return <Empty>this build ran no plugins</Empty>;
  const projectNames = new Map(setupInfo.projects.map((project) => [project.id, project.name]));
  const groups = [
    ...PHASE_ORDER.map((phase) => ({
      key: phase as string,
      label: PHASE_LABEL[phase],
      plugins: setupInfo.plugins.filter((plugin) => plugin.phases[0] === phase),
    })),
    // A plugin the manifest declares and no step uses. There are none today,
    // and the row that says so is the only place anyone would find out.
    { key: "unused", label: "declared, unused", plugins: setupInfo.plugins.filter((plugin) => plugin.phases.length === 0) },
  ].filter((group) => group.plugins.length > 0);

  return (
    <div className="overflow-hidden rounded-card border border-line shadow-xs">
      {groups.map((group) => (
        <section key={group.key} className="border-t border-line first:border-t-0">
          <h3 className="label flex items-center gap-2 bg-surface px-3 py-1.5">
            {group.label}
            <span className="text-muted/70">{group.plugins.length}</span>
          </h3>
          {group.plugins.map((plugin) => {
            const declared = setupInfo.steps.filter((step) => step.plugin === plugin.name);
            const runSteps = setupInfo.run?.steps.filter((step) => step.plugin === plugin.name) ?? [];
            const health = plugin.stepCount === 0 ? "unchecked" : healthFor(runSteps, declared.length, setupInfo);
            const outputs = [...new Set(runSteps.flatMap((step) => step.files))];
            return (
              <details key={plugin.name} id={`plugin-${plugin.name}`} className="group scroll-mt-4 border-t border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-1.5 hover:bg-surface/60">
                  {health === "healthy" ? <HealthDot health={health} /> : null}
                  <span className="mono truncate text-ink" title={plugin.name}>{plugin.name}</span>
                  <Runtime plugin={plugin} icon />
                  {health === "healthy" ? null : <HealthBadge health={health} />}
                  <span className="mono ml-auto shrink-0 text-muted">
                    {plugin.projectIds.length > 0
                      ? `${plugin.projectIds.length} ${plural(plugin.projectIds.length, "project")}`
                      : plugin.stepCount > 0
                        ? "estate"
                        : "—"}
                  </span>
                  <ChevronDown size={15} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-line bg-surface/50 px-4 py-4">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)]">
                    <div><div className="label mb-2">last run</div><PipelineSteps steps={runSteps} /></div>
                    <div className="space-y-4">
                      <div><div className="label mb-2">runtime</div><p className="mono"><Runtime plugin={plugin} /></p></div>
                      <div><div className="label mb-2">used by</div>{plugin.projectIds.length > 0 ? <div className="flex flex-wrap gap-1.5">{plugin.projectIds.map((id) => <a key={id} href={`#project-${id}`} className="chip border-line-strong hover:border-accent hover:text-accent">{projectNames.get(id) ?? id}</a>)}</div> : <p className="mono text-muted">{plugin.stepCount > 0 ? "Estate-wide catalog" : "No pipeline step uses this plugin."}</p>}</div>
                      {outputs.length > 0 ? <div><div className="label mb-2">outputs</div><ul className="mono space-y-1 text-muted">{outputs.map((output) => <li key={output} className="truncate"><FileLink path={output} /></li>)}</ul></div> : null}
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Appearance() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  return (
    <div className="grid gap-grid sm:grid-cols-2">
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">theme</div>
        <div className="seg inline-flex" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === "dark"} onClick={() => theme !== "dark" && toggleTheme()} className={`flex items-center gap-1.5 ${theme === "dark" ? "is-on" : ""}`}><Moon size={15} aria-hidden /> dark</button>
          <button type="button" aria-pressed={theme === "light"} onClick={() => theme !== "light" && toggleTheme()} className={`flex items-center gap-1.5 ${theme === "light" ? "is-on" : ""}`}><Sun size={15} aria-hidden /> light</button>
        </div>
      </div>
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">row density</div>
        <div className="seg inline-flex" role="group" aria-label="Row density">
          <button type="button" aria-pressed={density === "comfortable"} onClick={() => density !== "comfortable" && toggleDensity()} className={`flex items-center gap-1.5 ${density === "comfortable" ? "is-on" : ""}`}><Rows4 size={15} aria-hidden /> comfortable</button>
          <button type="button" aria-pressed={density === "compact"} onClick={() => density !== "compact" && toggleDensity()} className={`flex items-center gap-1.5 ${density === "compact" ? "is-on" : ""}`}><Rows2 size={15} aria-hidden /> compact</button>
        </div>
      </div>
    </div>
  );
}

const FIELD = "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <input className={FIELD} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} />
    </label>
  );
}

function AddProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-h-52 items-center justify-center rounded-card border border-dashed border-line-strong bg-canvas p-card text-left shadow-xs transition-colors hover:border-accent hover:bg-surface">
      <span className="flex max-w-72 flex-col items-center text-center">
        <span className="flex size-9 items-center justify-center rounded-full border border-line-strong text-muted group-hover:border-accent group-hover:text-accent"><Plus size={18} aria-hidden /></span>
        <span className="mt-3 font-semibold text-ink">Add a project</span>
        <span className="mt-1 text-muted">Point Portolan at a local service and it will suggest the extractors to use.</span>
      </span>
    </button>
  );
}

function Wizard({ open, onClose, onAdded, onGenerate }: { open: boolean; onClose: () => void; onAdded: (setup: SetupInfo) => void; onGenerate: () => Promise<void> }) {
  const [stage, setStage] = useState<"source" | "configure" | "review">("source");
  const [path, setPath] = useState("");
  const [repository, setRepository] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setStage("source"); setPath(""); setRepository(""); setDiscovery(null); setDraft(null); setPlan(null); setError(""); setBusy(false);
    }
  }, [open]);

  async function detect() {
    setBusy(true); setError("");
    try {
      const found = await discover(path);
      setDiscovery(found);
      setDraft({ root: found.root, repository, ...found.defaults, plugins: found.detections.filter((item) => item.selected).map((item) => item.plugin) });
      setStage("configure");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function review() {
    if (!draft) return;
    setBusy(true); setError("");
    try { setPlan(await previewProject(draft)); setStage("review"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function save(generate: boolean) {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const result = await addProject(draft);
      onAdded(result.setup);
      onClose();
      if (generate) await onGenerate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  const heading = stage === "source" ? "Add a local project" : stage === "configure" ? "Configure discovery" : "Review changes";
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} label={heading} width="min(760px,94vw)">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {stage !== "source" ? <button type="button" className="tbtn p-1.5" onClick={() => setStage(stage === "review" ? "configure" : "source")} aria-label="Back"><ArrowLeft size={16} /></button> : null}
        <div className="min-w-0 flex-1"><div className="font-semibold text-ink">{heading}</div><div className="mono mt-0.5 text-muted">{stage === "source" ? "1 / 3 · source" : stage === "configure" ? "2 / 3 · plugins" : "3 / 3 · manifest"}</div></div>
        <button type="button" className="tbtn p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {stage === "source" ? (
          <div className="space-y-5">
            <p className="text-muted">Use a repository-relative path. Detection reads file names only and does not execute project code.</p>
            <Field label="local path" value={path} onChange={setPath} placeholder="services/billing" required />
            <Field label="repository URL · optional" value={repository} onChange={setRepository} placeholder="https://github.com/acme/billing" />
          </div>
        ) : stage === "configure" && discovery && draft ? (
          <div className="space-y-5">
            <div className="rounded-control border border-line bg-surface px-3 py-2 text-muted"><span className="mono text-ink">{discovery.root}</span> · scanned {discovery.filesScanned} files{discovery.truncated ? " (limit reached)" : ""}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="project name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required />
              <Field label="project id" value={draft.id} onChange={(id) => setDraft({ ...draft, id })} required />
              <Field label="bounded context" value={draft.context} onChange={(context) => setDraft({ ...draft, context })} />
              <Field label="service slug" value={draft.service} onChange={(service) => setDraft({ ...draft, service })} />
            </div>
            <div><div className="label mb-2">detected plugins</div>
              {discovery.detections.length ? <div className="divide-y divide-line rounded-control border border-line">{discovery.detections.map((item) => {
                const checked = draft.plugins.includes(item.plugin);
                return <label key={item.plugin} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface"><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, plugins: checked ? draft.plugins.filter((name) => name !== item.plugin) : [...draft.plugins, item.plugin] })} /><span className="mono text-ink">{item.plugin}</span><span className="ml-auto text-muted">{item.evidence}</span><span className="chip status-verified">{item.confidence}</span></label>;
              })}</div> : <Empty>no supported project signals found</Empty>}
            </div>
          </div>
        ) : stage === "review" && plan ? (
          <div className="space-y-5">
            <div className="rounded-card border border-line bg-surface p-4"><div className="font-semibold text-ink">{plan.project.name}</div><div className="mono mt-1 text-muted">{plan.project.root}</div></div>
            <div><div className="label mb-2">portolan.json changes</div><dl className="mono grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-muted"><dt>project</dt><dd className="text-ink">{plan.project.id}</dd><dt>source</dt><dd className="truncate text-ink">{plan.source}</dd><dt>pipeline</dt><dd className="text-ink">{plan.steps.length} {plural(plan.steps.length, "extract step")}</dd></dl></div>
            <div className="divide-y divide-line rounded-control border border-line">{plan.steps.map((step) => <div key={step.plugin} className="mono grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr]"><span className="text-ink">{step.plugin}</span><span className="truncate text-muted">{step.in} → {step.out}</span></div>)}</div>
          </div>
        ) : null}
        {error ? <div role="alert" className="mt-4 rounded-control border border-unresolved px-3 py-2 text-unresolved">{error}</div> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" className="tbtn" onClick={onClose} disabled={busy}>Cancel</button>
        {stage === "source" ? <button type="button" className="btn-accent" onClick={() => void detect()} disabled={busy || !path.trim()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : null} Detect project</button> : null}
        {stage === "configure" ? <button type="button" className="btn-accent" onClick={() => void review()} disabled={busy || !draft?.plugins.length}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : null} Review</button> : null}
        {stage === "review" ? <><button type="button" className="tbtn" onClick={() => void save(false)} disabled={busy}>Add only</button><button type="button" className="btn-accent" onClick={() => void save(true)} disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Add & generate</button></> : null}
      </div>
    </Modal>
  );
}

function RunDialog({ runId, open, onClose, onFinished }: { runId: string | null; open: boolean; onClose: () => void; onFinished: () => void }) {
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
  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    return subscribeToRun(runId, (event) => { setEvents((current) => [...current, event]); if (event.type === "process-finished") onFinished(); }, onFinished);
  }, [runId, onFinished]);
  const total = pipeline?.type === "pipeline-ready" ? pipeline.stepCount : 0;
  const percent = total ? Math.round((steps.length / total) * 100) : 0;
  return (
    <Modal open={open} onClose={finished ? onClose : () => {}} label="Generate documentation" width="min(720px,94vw)">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4"><div className="flex-1"><div className="font-semibold text-ink">Generate documentation</div><div className="mono mt-0.5 text-muted">{finished ? `finished · ${finished.status}` : active?.type === "step-started" ? `${active.phase} · ${active.plugin}` : "starting generator…"}</div></div>{finished ? <button className="tbtn p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button> : <LoaderCircle size={18} className="animate-spin text-accent" />}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
        <div className="mono mt-2 flex justify-between text-muted"><span>{steps.length} / {total || "?"} steps</span><span>{percent}%</span></div>
        <div className="mt-4 divide-y divide-line rounded-control border border-line">{steps.map((event) => event.type === "step-finished" ? <div key={`${event.ordinal}:${event.plugin}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr_auto]"><span className="mono text-muted">{event.phase}</span><span className="mono text-ink">{event.plugin}</span><span className={`chip ${event.status === "failed" ? "status-unresolved" : "status-verified"}`}>{event.status}</span></div> : null)}</div>
        {logs.length ? <details className="mt-4"><summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary><pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">{logs.map((event) => event.type === "log" ? event.message : "").join("\n")}</pre></details> : null}
      </div>
      <div className="flex justify-end border-t border-line px-5 py-4">{finished ? <button type="button" className="btn-accent" onClick={onClose}>Done</button> : <button type="button" className="tbtn" onClick={() => runId && void cancelGeneration(runId)}>Cancel generation</button>}</div>
    </Modal>
  );
}

function SettingsContent({ local, onAdd, onGenerate }: { local: boolean; onAdd: () => void; onGenerate: () => void }) {
  const setupInfo = useSetup();
  const active = setupInfo.plugins.filter((plugin) => plugin.stepCount > 0);
  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-lg font-semibold">Settings</h1>{local ? <span className="chip status-verified">local mode</span> : null}</div><p className="mt-1 max-w-prose text-muted">The projects, plugins and local preferences used by this catalog. {local ? "This local session can update portolan.json and run the generator." : "Build configuration is read-only here and comes from portolan.json."}</p></div>{local ? <button type="button" className="btn-accent" onClick={onGenerate}><Play size={15} /> Generate docs</button> : null}</div>
        <BuildHealth />

        <div className="mt-4 grid grid-cols-2 gap-grid lg:grid-cols-4">
          <Metric value={setupInfo.projects.length} label="project" />
          <Metric value={active.length} label="active plugin" />
          <Metric value={setupInfo.steps.length} label="pipeline step" />
          <Metric value={catalogSources.length} label="catalog source" />
        </div>

        <section className="mt-section">
          <SectionTitle right={local ? "editable in local mode" : "declared in portolan.json"}>Projects</SectionTitle>
          {setupInfo.projects.length === 0 && !local ? <Empty>portolan.json names no projects — every input here is the estate's own</Empty> : <div className="grid gap-grid xl:grid-cols-2">{setupInfo.projects.map((project) => <ProjectCard key={project.id} project={project} />)}{local ? <AddProjectCard onClick={onAdd} /> : null}</div>}
        </section>

        <section className="mt-section">
          <SectionTitle right={`${active.length} of ${setupInfo.plugins.length} active`}>Plugins</SectionTitle>
          <PluginsList />
          <p className="mono mt-2 text-muted">WASM runs without filesystem, network or environment access. A host process runs with the permissions of the build.</p>
        </section>

        <section className="mt-section"><SectionTitle right="stored in this browser">Appearance</SectionTitle><Appearance /></section>

        <details className="mt-section rounded-card border border-line shadow-xs">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-ink">Advanced build inputs</summary>
          <div className="border-t border-line p-4">
            <div className="label mb-2">catalog source patterns</div>
            {setupInfo.sources.length === 0 ? <Empty>no source patterns declared</Empty> : <ul className="mono space-y-1 text-muted">{setupInfo.sources.map((source) => <li key={source}>{source}</li>)}</ul>}
            <div className="label mt-5 mb-2">pipeline</div>
            {setupInfo.steps.length === 0 ? <Empty>no pipeline steps declared</Empty> : <div className="space-y-1">{setupInfo.steps.map((step, index) => <div key={`${step.phase}:${step.plugin}:${step.input ?? "catalog"}:${index}`} className="mono grid gap-x-3 text-muted sm:grid-cols-[5rem_9rem_1fr]"><span>{step.phase}</span><span className="text-ink">{step.plugin}</span><span className="truncate" title={step.input ?? "merged catalog"}>{step.input ?? "merged catalog"} → {step.output}</span></div>)}</div>}
          </div>
        </details>

        <div className="mono mt-section flex items-center gap-2 pb-section text-muted"><Box size={14} aria-hidden />{local ? "Changes are written to portolan.json; generated files remain reviewable in git." : "Configuration is embedded at build time; changing it requires a new catalog build."}</div>
      </div>
    </div>
  );
}

export function Settings() {
  const [setup, setSetup] = useState<SetupInfo>(staticSetupInfo);
  const [local, setLocal] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const say = useToastStore((state) => state.say);
  const refresh = useCallback(async () => {
    try { const status = await localStatus(); setLocal(true); setSetup(status.setup); if (status.activeRun) { setRunId(status.activeRun.id); setRunOpen(true); } }
    catch { setLocal(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function generate() {
    try {
      const run = await startGeneration("write");
      setRunId(run.runId); setRunOpen(true);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <SetupContext.Provider value={setup}>
      <SettingsContent local={local} onAdd={() => setWizard(true)} onGenerate={() => void generate()} />
      <Wizard open={wizard} onClose={() => setWizard(false)} onAdded={setSetup} onGenerate={generate} />
      <RunDialog runId={runId} open={runOpen} onClose={() => setRunOpen(false)} onFinished={refresh} />
    </SetupContext.Provider>
  );
}
