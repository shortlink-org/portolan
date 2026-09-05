import { Link } from "react-router";
import {
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  FolderGit2,
  Moon,
  Rows2,
  Rows4,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";
import { catalog, catalogSources } from "../data";
import { useDensity } from "../app/density";
import { useTheme } from "../app/theme";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { setupInfo } from "../lib/setup-info";
import type {
  SetupPhase,
  SetupPlugin,
  SetupProject,
  SetupRunStep,
  SetupRunStepStatus,
} from "../lib/setup-info";
import { sourceHref, treeHref } from "../lib/source-link";
import { paths } from "../routes";
import { Empty, SectionTitle } from "../components/PageHeader";

type Health = "healthy" | "changed" | "failed" | "unchecked";

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

function healthFor(steps: SetupRunStep[], expected: number): Health {
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
        {run ? (
          <dl className="mono grid shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-muted sm:text-right">
            <dt>steps</dt>
            <dd className="text-ink">{completed}/{setupInfo.steps.length}</dd>
            <dt>run</dt>
            <dd className="text-ink">{run.mode} · {duration(run.durationMs)}</dd>
            {finished ? <><dt>finished</dt><dd className="text-ink" title={absoluteTime(finished)}>{relativeTime(finished)}</dd></> : null}
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
  const health = healthFor(runSteps, declared.length);
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
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-control font-medium text-ink">
          Pipeline and sources
          <ChevronDown size={16} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
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

function Runtime({ plugin }: { plugin: SetupPlugin }) {
  return plugin.runtime === "wasm" ? (
    <span className="inline-flex items-center gap-1.5 text-verified"><ShieldCheck size={14} aria-hidden /> WASM sandbox</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-declared"><Terminal size={14} aria-hidden /> host process</span>
  );
}

function PluginsList() {
  if (setupInfo.plugins.length === 0) return <Empty>this build ran no plugins</Empty>;
  const projectNames = new Map(setupInfo.projects.map((project) => [project.id, project.name]));

  return (
    <div className="overflow-hidden rounded-card border border-line shadow-xs">
      <div className="label hidden grid-cols-[minmax(10rem,1.5fr)_1fr_1.2fr_5rem_auto] gap-3 bg-surface px-4 py-2 md:grid">
        <span>plugin</span><span>phase</span><span>runtime</span><span>used by</span><span>status</span>
      </div>
      {setupInfo.plugins.map((plugin) => {
        const declared = setupInfo.steps.filter((step) => step.plugin === plugin.name);
        const runSteps = setupInfo.run?.steps.filter((step) => step.plugin === plugin.name) ?? [];
        const health = plugin.stepCount === 0 ? "unchecked" : healthFor(runSteps, declared.length);
        const outputs = [...new Set(runSteps.flatMap((step) => step.files))];
        return (
          <details key={plugin.name} id={`plugin-${plugin.name}`} className="group scroll-mt-4 border-t border-line first:border-t-0">
            <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 md:grid-cols-[minmax(10rem,1.5fr)_1fr_1.2fr_5rem_auto] md:items-center md:gap-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="mono truncate text-ink" title={plugin.name}>{plugin.name}</span>
                <ChevronDown size={15} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180 md:hidden" />
              </div>
              <span className="flex flex-wrap gap-1">{plugin.phases.map((phase) => <span key={phase} className="chip">{PHASE_LABEL[phase]}</span>)}{plugin.phases.length === 0 ? <span className="text-muted">unused</span> : null}</span>
              <span className="mono"><Runtime plugin={plugin} /></span>
              <span className="text-muted">
                {plugin.projectIds.length > 0 ? (
                  <><span className="md:hidden">used by </span>{plugin.projectIds.length} <span className="md:hidden">{plural(plugin.projectIds.length, "project")}</span></>
                ) : plugin.stepCount > 0 ? "estate" : "—"}
              </span>
              <div className="flex items-center justify-between gap-2 md:justify-end"><HealthBadge health={health} /><ChevronDown size={15} aria-hidden className="hidden shrink-0 text-muted transition-transform group-open:rotate-180 md:block" /></div>
            </summary>
            <div className="border-t border-line bg-surface/50 px-4 py-4">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)]">
                <div><div className="label mb-2">last run</div><PipelineSteps steps={runSteps} /></div>
                <div className="space-y-4">
                  <div><div className="label mb-2">used by</div>{plugin.projectIds.length > 0 ? <div className="flex flex-wrap gap-1.5">{plugin.projectIds.map((id) => <a key={id} href={`#project-${id}`} className="chip border-line-strong hover:border-accent hover:text-accent">{projectNames.get(id) ?? id}</a>)}</div> : <p className="mono text-muted">{plugin.stepCount > 0 ? "Estate-wide catalog" : "No pipeline step uses this plugin."}</p>}</div>
                  {outputs.length > 0 ? <div><div className="label mb-2">outputs</div><ul className="mono space-y-1 text-muted">{outputs.map((output) => <li key={output} className="truncate"><FileLink path={output} /></li>)}</ul></div> : null}
                </div>
              </div>
            </div>
          </details>
        );
      })}
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

export function Settings() {
  const active = setupInfo.plugins.filter((plugin) => plugin.stepCount > 0);
  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 max-w-prose text-muted">The projects, plugins and local preferences used by this catalog. Build configuration is read-only here and comes from portolan.json.</p>
        <BuildHealth />

        <div className="mt-4 grid grid-cols-2 gap-grid lg:grid-cols-4">
          <Metric value={setupInfo.projects.length} label="project" />
          <Metric value={active.length} label="active plugin" />
          <Metric value={setupInfo.steps.length} label="pipeline step" />
          <Metric value={catalogSources.length} label="catalog source" />
        </div>

        <section className="mt-section">
          <SectionTitle right="declared in portolan.json">Projects</SectionTitle>
          {setupInfo.projects.length === 0 ? <Empty>portolan.json names no projects — every input here is the estate's own</Empty> : <div className="grid gap-grid xl:grid-cols-2">{setupInfo.projects.map((project) => <ProjectCard key={project.id} project={project} />)}</div>}
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

        <div className="mono mt-section flex items-center gap-2 pb-section text-muted"><Box size={14} aria-hidden />Configuration is embedded at build time; changing it requires a new catalog build.</div>
      </div>
    </div>
  );
}
