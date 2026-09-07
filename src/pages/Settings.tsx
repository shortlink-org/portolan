import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  FolderGit2,
  KeyRound,
  LoaderCircle,
  Moon,
  Play,
  Plus,
  Rows2,
  Rows4,
  ShieldCheck,
  Sun,
  Terminal,
  Trash2,
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
  applyProjectTrial,
  cancelGeneration,
  discover,
  disposeProjectTrial,
  forgetRepositoryCredential,
  inspectRepository,
  LocalApiError,
  localStatus,
  saveRepositoryCredential,
  startGeneration,
  startProjectTrial,
  subscribeToRun,
} from "../lib/local-api";
import type { Discovery, ProjectDraft, ProjectPlan, RunEvent } from "../lib/local-api";
import { sourceHref, treeHref } from "../lib/source-link";
import { paths } from "../routes";
import { Empty, SectionTitle } from "../components/PageHeader";
import { Modal } from "../components/Overlay";
import { MachineDocs } from "../components/MachineDocs";
import { ChatSection } from "../chat/ChatSettings";
import { BUILD as CHAT_BUILD } from "../chat/flags";

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
  const group = project.group ?? project.context;
  const component = project.component ?? project.service;
  const context = catalog.contexts.find((item) => item.id === group);
  if (!context) return null;
  const service = context.services.find(
    (item) =>
      item.slug === component ||
      item.id === component ||
      item.id === `${context.id}.${component}`,
  );
  return service ? paths.service(context.id, service.slug) : paths.context(context.id);
}

function forge(project: SetupProject): { href: string; title: string } | null {
  if (project.repository) {
    return {
      href: treeHref(project.root, { repo: project.repository }, catalog.repos) ?? project.repository,
      title: "Open the project's source at the fetched commit",
    };
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
          <StepWarnings warnings={step.warnings} />
        </div>
      ))}
    </div>
  );
}

// What a plugin could not read, in its own words. For a tree the extractor
// only half understood this is the list of what to fix, so it is shown where
// the step is rather than left on the terminal it scrolled off.
function StepWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <details className="mt-2" open={warnings.length <= 5}>
      <summary className="mono cursor-pointer text-muted">
        {warnings.length} {plural(warnings.length, "warning")}
      </summary>
      <ul className="mono mt-1 space-y-1 text-muted">
        {warnings.map((warning, index) => (
          <li key={`${index}:${warning}`} className="break-words border-l-2 border-line pl-2">
            {warning}
          </li>
        ))}
      </ul>
    </details>
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
        <dt>scope</dt><dd className="truncate text-ink">{[project.group ?? project.context, project.component ?? project.service].filter(Boolean).join(" · ") || "estate"}</dd>
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
        <span className="mt-1 text-muted">Point Portolan at a local component or repository and it will suggest the extractors to use.</span>
      </span>
    </button>
  );
}

const CAPABILITIES: Record<string, { title: string; summary: string }> = {
  project: { title: "Component metadata", summary: "Name, ownership, repository and runnable commands." },
  "go-domain": { title: "Go domain model", summary: "Aggregates, entities, value objects and domain events." },
  "ts-domain": { title: "TypeScript domain model", summary: "Aggregates, entities, value objects and domain events." },
  "rust-domain": { title: "Rust domain model", summary: "Aggregates, entities, value objects and domain events." },
  "java-domain": { title: "Java domain model", summary: "Aggregates, entities, value objects and domain events." },
  "django-domain": { title: "Django data model", summary: "Models and their relationships." },
  openapi: { title: "HTTP API contract", summary: "Operations and messages declared by OpenAPI or Swagger." },
  wsdl: { title: "SOAP contract", summary: "Services, operations and messages declared by WSDL." },
  "http-clients": { title: "Outbound integrations", summary: "HTTP and SOAP calls, provider branches and code flows." },
  redis: { title: "Redis data model", summary: "Clients, key patterns and stored value hints." },
  river: { title: "River jobs", summary: "Job producers, workers and their code flows." },
  watermill: { title: "Watermill messaging", summary: "Publishers, handlers, topics and their code flows." },
  asyncapi: { title: "Messaging contract", summary: "Channels and messages declared by AsyncAPI." },
  celery: { title: "Celery jobs", summary: "Tasks, producers and worker flows." },
  graphql: { title: "GraphQL contract", summary: "Queries, mutations and schema types." },
  proto: { title: "Protobuf contract", summary: "gRPC services, methods and messages." },
  sql: { title: "SQL data model", summary: "Stores, tables, columns and relationships." },
  adr: { title: "Architecture decisions", summary: "ADRs and their catalog relationships." },
  glossary: { title: "Glossary", summary: "Project language and shared definitions." },
};

function RepositoryFailure({ failure, message, token, onTokenChange, onForget, busy }: { failure: LocalApiError; message: string; token: string; onTokenChange: (value: string) => void; onForget: () => void; busy: boolean }) {
  const authFailure = failure.code === "repository_auth_required" || failure.code === "repository_forbidden";
  const title = failure.code === "repository_auth_required" ? "Authentication required" : failure.code === "repository_forbidden" ? "Repository access denied" : failure.code === "repository_timeout" ? "Repository timed out" : "Repository unavailable";
  const guidance = failure.code === "repository_auth_required"
    ? "Authenticate with your Git credential helper or provide a session token below."
    : failure.code === "repository_forbidden"
      ? "Confirm read access and, where required, approve the credential for organization SSO."
      : failure.code === "repository_timeout"
        ? "Check connectivity, VPN and proxy settings. The retry stays on this step."
        : "Verify the repository URL and ref before retrying.";
  const scope = failure.provider === "GitHub" ? "Use a fine-grained token with Contents: Read, or a classic token with repo access." : "Use a token with the read_repository scope.";
  return (
    <div role="alert" className="mt-4 rounded-control border border-unresolved bg-surface px-3 py-3">
      <div className="flex items-start gap-3">
        <CircleAlert size={18} className="mt-0.5 shrink-0 text-unresolved" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{title}</span><span className="chip status-unresolved">{failure.status}</span>{failure.provider ? <span className="chip status-declared">{failure.provider}</span> : null}</div>
          <p className="mt-1 text-muted">{message}</p>
          <p className="mt-2 text-muted">{guidance}</p>
          {authFailure && failure.credentialSupported ? <div className="mt-3 rounded-control border border-line bg-canvas p-3"><div className="flex items-center gap-2 font-medium text-ink"><KeyRound size={15} /> {failure.credentialPresent ? "Replace session token" : "Use an access token"}</div><p className="mt-1 text-muted">{scope} It stays only in this local process and is forgotten when the server stops.</p><label className="mt-3 block"><span className="label mb-1.5 block">{failure.provider} access token</span><input className={FIELD} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="token is never written to the repository" /></label>{failure.credentialPresent ? <button type="button" className="tbtn mt-3" onClick={onForget} disabled={busy}><Trash2 size={14} /> Forget saved token</button> : null}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Wizard({ open, onClose, onAdded, onRunStarted }: { open: boolean; onClose: () => void; onAdded: (setup: SetupInfo) => void; onRunStarted: (runId: string) => void }) {
  const [source, setSource] = useState<"local" | "external">("local");
  const [stage, setStage] = useState<"source" | "scope" | "configure" | "trial">("source");
  const [path, setPath] = useState("");
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("main");
  const [sourcePath, setSourcePath] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scopeDiscovery, setScopeDiscovery] = useState<Discovery | null>(null);
  const [inspectionCommit, setInspectionCommit] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [pendingComponents, setPendingComponents] = useState<string[]>([]);
  const [batchPosition, setBatchPosition] = useState<{ current: number; total: number } | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [trialRunId, setTrialRunId] = useState<string | null>(null);
  const [trialEvents, setTrialEvents] = useState<RunEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repositoryError, setRepositoryError] = useState<LocalApiError | null>(null);
  const [retryComponent, setRetryComponent] = useState<{ path: string; batch: boolean } | null>(null);
  const [credentialToken, setCredentialToken] = useState("");

  useEffect(() => {
    if (!open) {
      setStage("source"); setSource("local"); setPath(""); setRepository(""); setRef("main"); setSourcePath(""); setDiscovery(null); setScopeDiscovery(null); setInspectionCommit(""); setSelectedComponents([]); setPendingComponents([]); setBatchPosition(null); setDraft(null); setPlan(null); setTrialRunId(null); setTrialEvents([]); setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken(""); setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!trialRunId) return;
    return subscribeToRun(
      trialRunId,
      (event) => setTrialEvents((current) => [...current, event]),
      () => {},
    );
  }, [trialRunId]);

  function clearRepositoryFailure() {
    setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken("");
  }

  function selectSource(next: "local" | "external") {
    setSource(next);
    clearRepositoryFailure();
  }

  async function detect() {
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    setScopeDiscovery(null);
    setSelectedComponents([]); setPendingComponents([]); setBatchPosition(null);
    try {
      const inspection = source === "external" ? await inspectRepository(repository, ref, sourcePath) : null;
      const found = inspection?.discovery ?? await discover(path);
      const commit = inspection?.commit ?? "";
      setInspectionCommit(commit);
      if (!sourcePath.trim() && found.components.some((component) => component.path !== ".")) {
        const onlyComponent = found.components.length === 1 ? found.components[0]?.path : undefined;
        setScopeDiscovery(found); setSelectedComponents(onlyComponent ? [onlyComponent] : []); setStage("scope");
      } else configure(found, commit, sourcePath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setRepositoryError(cause instanceof LocalApiError && cause.code?.startsWith("repository_") ? cause : null); }
    finally { setBusy(false); }
  }

  function configure(found: Discovery, commit: string, selectedSourcePath: string, projectId?: string) {
    setDiscovery(found);
    setDraft({ source, root: found.root, repository, ref, commit, sourcePath: selectedSourcePath, ...found.defaults, ...(projectId ? { id: projectId } : {}), plugins: found.detections.filter((item) => item.selected).map((item) => item.plugin) });
    setStage("configure");
  }

  async function chooseComponent(componentPath: string, batch = false) {
    if (!scopeDiscovery) return;
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    try {
      const projectId = batch && componentPath !== "." ? componentPath.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined;
      if (source === "external") {
        const selected = componentPath === "." ? "" : componentPath;
        const inspection = await inspectRepository(repository, inspectionCommit || ref, selected);
        configure(inspection.discovery, inspection.commit, selected, projectId);
      } else {
        const base = path.replace(/\/$/, "");
        const selected = componentPath === "." ? base : [base === "." ? "" : base, componentPath].filter(Boolean).join("/");
        configure(componentPath === "." ? scopeDiscovery : await discover(selected), "", "", projectId);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setRepositoryError(cause instanceof LocalApiError && cause.code?.startsWith("repository_") ? cause : null); setRetryComponent({ path: componentPath, batch }); }
    finally { setBusy(false); }
  }

  async function reviewSelectedComponents() {
    if (!scopeDiscovery || selectedComponents.length === 0) return;
    const ordered = scopeDiscovery.components.map((component) => component.path).filter((componentPath) => selectedComponents.includes(componentPath));
    const first = ordered[0];
    if (!first) return;
    setPendingComponents(ordered.slice(1));
    setBatchPosition(ordered.length > 1 ? { current: 1, total: ordered.length } : null);
    await chooseComponent(first, ordered.length > 1);
  }

  function retryInspection() {
    return retryComponent ? chooseComponent(retryComponent.path, retryComponent.batch) : detect();
  }

  async function authenticateRepository() {
    if (!credentialToken.trim()) return;
    setBusy(true);
    try {
      await saveRepositoryCredential(repository, credentialToken);
      setCredentialToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      return;
    }
    setBusy(false);
    await retryInspection();
  }

  async function forgetCredential() {
    if (!repositoryError) return;
    setBusy(true);
    try {
      await forgetRepositoryCredential(repository);
      setCredentialToken("");
      setRepositoryError(new LocalApiError(repositoryError.message, {
        status: repositoryError.status, code: repositoryError.code, retryable: repositoryError.retryable, provider: repositoryError.provider, host: repositoryError.host, credentialSupported: repositoryError.credentialSupported, credentialPresent: false,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function runTrial() {
    if (!draft) return;
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    try {
      const result = await startProjectTrial(draft);
      setPlan(result.plan); setTrialEvents([]); setTrialRunId(result.runId); setStage("trial");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function applyTrial(generate: boolean) {
    if (!trialRunId) return;
    setBusy(true); setError("");
    try {
      const result = await applyProjectTrial(trialRunId, generate);
      onAdded(result.setup);
      if (pendingComponents.length > 0) {
        const [next, ...remaining] = pendingComponents;
        if (!next) throw new Error("The next selected component is missing.");
        setPendingComponents(remaining); setBatchPosition((position) => position ? { ...position, current: position.current + 1 } : null);
        setTrialRunId(null); setTrialEvents([]); setPlan(null);
        await chooseComponent(next, true);
      } else {
        onClose();
        if (result.run) onRunStarted(result.run.runId);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  const finished = trialEvents.slice().reverse().find((event): event is Extract<RunEvent, { type: "process-finished" }> => event.type === "process-finished");
  const pipeline = trialEvents.find((event): event is Extract<RunEvent, { type: "pipeline-ready" }> => event.type === "pipeline-ready");
  const completedSteps = trialEvents.filter((event): event is Extract<RunEvent, { type: "step-finished" }> => event.type === "step-finished");
  const activeStep = trialEvents.slice().reverse().find((event): event is Extract<RunEvent, { type: "step-started" }> => event.type === "step-started");
  const trial = trialEvents.find((event): event is Extract<RunEvent, { type: "project-trial-ready" }> => event.type === "project-trial-ready");
  const logs = trialEvents.filter((event): event is Extract<RunEvent, { type: "log" }> => event.type === "log");
  const trialRunning = stage === "trial" && !finished;
  const totalSteps = pipeline?.stepCount ?? plan?.steps.length ?? 0;
  const percent = totalSteps ? Math.round((completedSteps.length / totalSteps) * 100) : 0;
  const heading = stage === "source" ? "Add a project" : stage === "scope" ? "Choose a component" : stage === "configure" ? "Review discovery" : "Trial extraction";
  function back() {
    if (stage === "trial") { if (trialRunId) void disposeProjectTrial(trialRunId); setStage("configure"); setTrialRunId(null); setTrialEvents([]); setPlan(null); }
    else if (stage === "configure" && scopeDiscovery) { setStage("scope"); setPendingComponents([]); setBatchPosition(null); }
    else setStage("source");
    setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken("");
  }
  return (
    <Modal open={open} onClose={busy || trialRunning ? () => {} : onClose} label={heading} width="min(800px,94vw)">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {stage !== "source" ? <button type="button" className="tbtn p-1.5" onClick={back} disabled={trialRunning || busy} aria-label="Back"><ArrowLeft size={16} /></button> : null}
        <div className="min-w-0 flex-1"><div className="font-semibold text-ink">{heading}</div><div className="mono mt-0.5 text-muted">{stage === "source" ? "1 / 4 · source" : stage === "scope" ? "2 / 4 · scope" : stage === "configure" ? `3 / 4 · capabilities${batchPosition ? ` · ${batchPosition.current} / ${batchPosition.total}` : ""}` : `4 / 4 · proof${batchPosition ? ` · ${batchPosition.current} / ${batchPosition.total}` : ""}`}</div></div>
        <button type="button" className="tbtn p-1.5" onClick={onClose} disabled={busy || trialRunning} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {stage === "source" ? (
          repositoryError ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface px-3 py-2"><div className="min-w-0"><div className="mono truncate text-ink">{repository}</div><div className="mono mt-0.5 text-muted">{ref || "HEAD"}{sourcePath ? ` · ${sourcePath}` : ""}</div></div><button type="button" className="tbtn" onClick={clearRepositoryFailure}>Edit source</button></div> : <div className="space-y-5">
            <div className="seg inline-flex" role="group" aria-label="Project source"><button type="button" className={source === "local" ? "is-on" : ""} aria-pressed={source === "local"} onClick={() => selectSource("local")}>local directory</button><button type="button" className={source === "external" ? "is-on" : ""} aria-pressed={source === "external"} onClick={() => selectSource("external")}>external repository</button></div>
            <p className="text-muted">Detection reads project files but does not execute project code. External repositories are pinned and vendored through the built-in git fetcher.</p>
            {source === "local" ? <><Field label="local path" value={path} onChange={setPath} placeholder="services/billing" required /><Field label="repository URL · optional" value={repository} onChange={(value) => { setRepository(value); clearRepositoryFailure(); }} placeholder="https://github.com/acme/billing" /></> : <><Field label="repository URL" value={repository} onChange={(value) => { setRepository(value); clearRepositoryFailure(); }} placeholder="https://github.com/acme/platform" required /><div className="grid gap-4 sm:grid-cols-2"><Field label="branch, tag or commit" value={ref} onChange={(value) => { setRef(value); clearRepositoryFailure(); }} placeholder="main" /><Field label="component path · optional" value={sourcePath} onChange={(value) => { setSourcePath(value); clearRepositoryFailure(); }} placeholder="services/billing" /></div></>}
          </div>
        ) : stage === "scope" && scopeDiscovery ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-ink">Portolan found {scopeDiscovery.components.length} possible {plural(scopeDiscovery.components.length, "component")}.</p><p className="mt-1 text-muted">Select one or several modules. Each selected component gets its own scoped discovery and trial before it is added. In a batch, confirmed components are applied one at a time, so you can stop between them.</p></div><div className="flex gap-2"><button type="button" className="tbtn" onClick={() => setSelectedComponents(scopeDiscovery.components.map((component) => component.path))}>Select all</button><button type="button" className="tbtn" onClick={() => setSelectedComponents([])} disabled={!selectedComponents.length}>Clear</button></div></div>
            <div className="grid gap-2">{scopeDiscovery.components.map((component) => { const selected = selectedComponents.includes(component.path); return <button type="button" key={component.path} aria-pressed={selected} onClick={() => setSelectedComponents((current) => selected ? current.filter((item) => item !== component.path) : [...current, component.path])} disabled={busy} className={`flex items-center gap-3 rounded-control border px-3 py-3 text-left transition-colors hover:border-accent hover:bg-surface ${selected ? "border-accent bg-surface" : "border-line"}`}><span className={`flex size-9 shrink-0 items-center justify-center rounded-control ${selected ? "bg-accent text-canvas" : "bg-surface text-muted"}`}>{selected ? <Check size={17} /> : <FolderGit2 size={17} />}</span><span className="min-w-0 flex-1"><span className="font-medium text-ink">{component.name}</span><span className="mono mt-0.5 block truncate text-muted">{component.path === "." ? "repository root" : component.path}</span></span><span className="flex flex-wrap justify-end gap-1">{component.technologies.map((technology) => <span key={technology} className="chip status-declared">{technology}</span>)}</span></button>; })}</div>
            {scopeDiscovery.componentsTruncated ? <p className="text-declared">Showing the first {scopeDiscovery.components.length} component roots. Narrow the source path to inspect the rest.</p> : null}
          </div>
        ) : stage === "configure" && discovery && draft ? (
          <div className="space-y-5">
            <div className="rounded-control border border-line bg-surface px-3 py-2 text-muted"><span className="mono text-ink">{draft.source === "external" ? `${draft.repository}@${draft.commit.slice(0, 7)}${draft.sourcePath ? `/${draft.sourcePath}` : ""}` : discovery.root}</span> · scanned {discovery.filesScanned} files{discovery.truncated ? " (limit reached)" : ""}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="project name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required />
              <Field label="project id" value={draft.id} onChange={(id) => setDraft({ ...draft, id })} required />
              <Field label="group" value={draft.group} onChange={(group) => setDraft({ ...draft, group })} />
              <Field label="component slug" value={draft.component} onChange={(component) => setDraft({ ...draft, component })} />
            </div>
            <div><div className="label mb-2">detected capabilities</div>
              {discovery.detections.length ? <div className="grid gap-2">{discovery.detections.map((item) => {
                const checked = draft.plugins.includes(item.plugin);
                const capability = CAPABILITIES[item.plugin] ?? { title: item.plugin, summary: "Catalog facts extracted from project files." };
                return <label key={item.plugin} className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-3 transition-colors ${checked ? "border-accent bg-surface" : "border-line hover:bg-surface"}`}><input className="mt-1" type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, plugins: checked ? draft.plugins.filter((name) => name !== item.plugin) : [...draft.plugins, item.plugin] })} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{capability.title}</span><span className={`chip ${item.confidence === "high" ? "status-verified" : "status-declared"}`}>{item.confidence} confidence</span>{item.candidates.length > 1 ? <span className="chip status-declared">{item.candidates.length} candidates</span> : null}</span><span className="mt-0.5 block text-muted">{capability.summary}</span><span className="mono mt-1 block truncate text-faint" title={item.evidence}>evidence · {item.evidence}</span><span className="mono mt-0.5 block text-faint">extractor · {item.plugin}</span></span></label>;
              })}</div> : <Empty>no supported project signals found</Empty>}
            </div>
          </div>
        ) : stage === "trial" && plan ? (
          <div className="space-y-5">
            <div className={`rounded-control border px-3 py-3 ${trial ? "border-verified bg-surface" : finished?.status === "failed" ? "border-unresolved" : "border-line bg-surface"}`}>
              <div className="flex items-start gap-3">{trial ? <Check size={18} className="mt-0.5 shrink-0 text-verified" /> : finished?.status === "failed" ? <CircleAlert size={18} className="mt-0.5 shrink-0 text-unresolved" /> : <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />}<div><div className="font-medium text-ink">{trial ? "Extraction succeeded — repository unchanged" : finished?.status === "failed" ? "Trial extraction failed" : activeStep ? `Running ${activeStep.plugin}` : "Creating an isolated workspace…"}</div><p className="mt-0.5 text-muted">{trial ? "These results came from real catalog fragments. Apply is now safe to continue." : "Portolan is running the selected extractors without writing to portolan.json or your project."}</p></div></div>
              {trial?.previewUrl ? <a className="btn-accent mt-3 inline-flex" href={trial.previewUrl} target="_blank" rel="noreferrer">Open catalog preview ↗</a> : null}
              {trial?.previewError ? <p className="mt-2 text-declared">The extraction is valid, but the temporary site could not start: {trial.previewError}</p> : null}
              {!finished ? <><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div><div className="mono mt-1 text-right text-muted">{completedSteps.length} / {totalSteps || "?"} steps</div></> : null}
            </div>
            {trial?.facts.length ? <section><div className="label mb-2">catalog facts found</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{trial.facts.map((fact) => <div key={fact.key} className="rounded-control border border-line bg-canvas px-3 py-2"><div className="tnum text-lg font-semibold text-ink">{fact.count}</div><div className="text-muted">{fact.label}</div></div>)}</div></section> : null}
            <section><div className="label mb-2">extractor results</div><div className="divide-y divide-line rounded-control border border-line">{(trial?.steps ?? completedSteps).map((step) => <div key={`${step.plugin}:${"ordinal" in step ? step.ordinal : "trial"}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_auto_auto]"><span><span className="font-medium text-ink">{CAPABILITIES[step.plugin]?.title ?? step.plugin}</span><span className="mono ml-2 text-faint">{step.plugin}</span>{step.message ? <span className="mt-1 block text-unresolved">{step.message}</span> : null}</span><span className="mono text-muted">{step.fileCount} {plural(step.fileCount, "file")}</span><span className={`chip ${step.status === "failed" ? "status-unresolved" : "status-verified"}`}>{step.status === "failed" ? "failed" : "read"}</span></div>)}</div></section>
            {trial?.warnings.length ? <section><div className="label mb-2">warnings · {trial.warnings.length}</div><div className="space-y-2">{trial.warnings.map((warning, index) => <div key={`${warning.plugin}:${index}`} className="flex gap-2 rounded-control border border-declared px-3 py-2 text-muted"><CircleAlert size={15} className="mt-0.5 shrink-0 text-declared" /><span><span className="mono text-ink">{warning.plugin}</span> · {warning.message}</span></div>)}</div></section> : null}
            {finished?.status === "failed" && logs.length ? <details><summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary><pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">{logs.map((event) => event.message).join("\n")}</pre></details> : null}
            {trial ? <div><div className="label mb-2">changes after apply</div><dl className="mono grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-muted"><dt>project</dt><dd className="text-ink">{plan.project.id}</dd>{plan.fetch ? <><dt>pin</dt><dd className="truncate text-ink">{plan.fetch.commit.slice(0, 12)}</dd></> : null}<dt>source</dt><dd className="truncate text-ink">{plan.source}</dd><dt>pipeline</dt><dd className="text-ink">{plan.steps.length + (plan.fetch ? 1 : 0)} {plural(plan.steps.length + (plan.fetch ? 1 : 0), "extract step")}</dd><dt>fragments</dt><dd className="text-ink">{trial.generatedFiles} generated</dd></dl></div> : null}
          </div>
        ) : null}
        {error ? repositoryError ? <RepositoryFailure failure={repositoryError} message={error} token={credentialToken} onTokenChange={setCredentialToken} onForget={() => void forgetCredential()} busy={busy} /> : <div role="alert" className="mt-4 rounded-control border border-unresolved px-3 py-2 text-unresolved">{error}</div> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" className="tbtn" onClick={onClose} disabled={busy || trialRunning}>Cancel</button>
        {stage === "source" ? <button key={repositoryError?.retryable ? "retry-inspection" : source} type="button" className="btn-accent" aria-label={repositoryError?.retryable ? credentialToken.trim() ? "Save token and retry" : "Retry inspection" : source === "external" ? "Inspect repository" : "Detect project"} onClick={() => void (repositoryError?.retryable ? credentialToken.trim() ? authenticateRepository() : retryInspection() : detect())} disabled={busy || (source === "local" ? !path.trim() : !repository.trim())}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : null} {repositoryError?.retryable ? credentialToken.trim() ? "Save token & retry" : "Retry inspection" : source === "external" ? "Inspect repository" : "Detect project"}</button> : null}
        {stage === "scope" ? <button key={repositoryError?.retryable ? "retry-component" : "review-components"} type="button" className="btn-accent" aria-label={repositoryError?.retryable ? credentialToken.trim() ? "Save token and retry" : "Retry inspection" : `Review ${selectedComponents.length || "selected"} ${selectedComponents.length === 1 ? "component" : "components"}`} onClick={() => void (repositoryError?.retryable ? credentialToken.trim() ? authenticateRepository() : retryInspection() : reviewSelectedComponents())} disabled={busy || (!repositoryError?.retryable && !selectedComponents.length)}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} {repositoryError?.retryable ? credentialToken.trim() ? "Save token & retry" : "Retry inspection" : <>Review {selectedComponents.length || "selected"} {selectedComponents.length === 1 ? "component" : "components"}</>}</button> : null}
        {stage === "configure" ? <button type="button" className="btn-accent" onClick={() => void runTrial()} disabled={busy || !draft?.plugins.length}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Run trial extraction</button> : null}
        {stage === "trial" && trialRunning ? <button type="button" className="tbtn" onClick={() => trialRunId && void cancelGeneration(trialRunId)}>Cancel trial</button> : null}
        {stage === "trial" && finished && !trial ? <button type="button" className="btn-accent" onClick={back}>Back to configuration</button> : null}
        {stage === "trial" && trial ? pendingComponents.length > 0 ? <button type="button" className="btn-accent" onClick={() => void applyTrial(false)} disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Add & review next</button> : <><button type="button" className="tbtn" onClick={() => void applyTrial(false)} disabled={busy}>Add without generating</button><button type="button" className="btn-accent" onClick={() => void applyTrial(true)} disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Add & generate</button></> : null}
      </div>
    </Modal>
  );
}

function RunDialog({ runId, open, onClose, onFinished, onApply }: { runId: string | null; open: boolean; onClose: () => void; onFinished: () => void; onApply: (previewRunId: string) => void }) {
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
      <div className="flex items-center gap-3 border-b border-line px-5 py-4"><div className="flex-1"><div className="font-semibold text-ink">{run?.mode === "preview" ? "Preview generated changes" : "Generate documentation"}</div><div className="mono mt-0.5 text-muted">{finished ? `finished · ${finished.status}` : active?.type === "step-started" ? `${active.phase} · ${active.plugin}` : run?.mode === "preview" ? "creating an isolated workspace…" : "starting generator…"}</div></div>{finished ? <button className="tbtn p-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button> : <LoaderCircle size={18} className="animate-spin text-accent" />}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
        <div className="mono mt-2 flex justify-between text-muted"><span>{steps.length} / {total || "?"} steps</span><span>{percent}%</span></div>
        <div className="mt-4 divide-y divide-line rounded-control border border-line">{steps.map((event) => event.type === "step-finished" ? <div key={`${event.ordinal}:${event.plugin}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_1fr_auto]"><span className="mono text-muted">{event.phase}</span><span className="mono text-ink">{event.plugin}</span><span className={`chip ${event.status === "failed" ? "status-unresolved" : "status-verified"}`}>{event.status}</span></div> : null)}</div>
        {preview ? <section className="mt-5"><div className="label mb-2">generated diff · {preview.totalFiles} {plural(preview.totalFiles, "file")}</div>{preview.files.length ? <div className="divide-y divide-line overflow-hidden rounded-control border border-line">{preview.files.map((file) => <details key={file.path} className="group"><summary className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface"><span className={`chip ${file.status === "removed" ? "status-unresolved" : file.status === "added" ? "status-verified" : "status-declared"}`}>{file.status}</span><span className="mono truncate text-ink">{file.path}</span><ChevronDown size={15} className="ml-auto shrink-0 text-muted transition-transform group-open:rotate-180" /></summary><pre className="mono max-h-80 overflow-auto whitespace-pre p-3 text-muted bg-surface">{file.diff || "Binary file changed"}</pre></details>)}</div> : <div className="rounded-control border border-line bg-surface px-3 py-3 text-muted">Generated documentation is already up to date.</div>}{preview.truncated ? <p className="mt-2 text-muted">Showing the first {preview.files.length} changed files.</p> : null}</section> : null}
        {logs.length ? <details className="mt-4"><summary className="cursor-pointer text-muted">Generator log · {logs.length} lines</summary><pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 text-muted">{logs.map((event) => event.type === "log" ? event.message : "").join("\n")}</pre></details> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{finished ? <><button type="button" className="tbtn" onClick={onClose}>{preview?.files.length ? "Cancel" : "Done"}</button>{preview?.files.length && finished.status === "ok" && runId ? <button type="button" className="btn-accent" onClick={() => onApply(runId)}><Play size={15} /> Apply changes</button> : null}</> : <button type="button" className="tbtn" onClick={() => runId && void cancelGeneration(runId)}>Cancel generation</button>}</div>
    </Modal>
  );
}

function SettingsContent({ local, onAdd, onGenerate }: { local: boolean; onAdd: () => void; onGenerate: () => void }) {
  const setupInfo = useSetup();
  const active = setupInfo.plugins.filter((plugin) => plugin.stepCount > 0);
  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-lg font-semibold">Settings</h1>{local ? <span className="chip status-verified">local mode</span> : null}</div><p className="mt-1 max-w-prose text-muted">The projects, plugins and local preferences used by this catalog. {local ? "This local session can update portolan.json and preview generator output." : "Build configuration is read-only here and comes from portolan.json."}</p></div>{local ? <button type="button" className="btn-accent" onClick={onGenerate}><Play size={15} /> Preview generated diff</button> : null}</div>
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

        {CHAT_BUILD.built ? <section className="mt-section"><SectionTitle right="stored in this browser">Ask the catalog</SectionTitle><ChatSection /></section> : null}

        <details className="mt-section rounded-card border border-line shadow-xs">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-ink">Advanced build inputs</summary>
          <div className="border-t border-line p-4">
            <div className="label mb-2">catalog source patterns</div>
            {setupInfo.sources.length === 0 ? <Empty>no source patterns declared</Empty> : <ul className="mono space-y-1 text-muted">{setupInfo.sources.map((source) => <li key={source}>{source}</li>)}</ul>}
            <div className="label mt-5 mb-2">pipeline</div>
            {setupInfo.steps.length === 0 ? <Empty>no pipeline steps declared</Empty> : <div className="space-y-1">{setupInfo.steps.map((step, index) => <div key={`${step.phase}:${step.plugin}:${step.input ?? "catalog"}:${index}`} className="mono grid gap-x-3 text-muted sm:grid-cols-[5rem_9rem_1fr]"><span>{step.phase}</span><span className="text-ink">{step.plugin}</span><span className="truncate" title={step.input ?? "merged catalog"}>{step.input ?? "merged catalog"} → {step.output}</span></div>)}</div>}
            <div className="label mt-5 mb-2">generated documentation</div>
            <MachineDocs />
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
  async function generate(previewRunId?: string) {
    try {
      const run = await startGeneration(previewRunId ? "write" : "preview", previewRunId);
      setRunId(run.runId); setRunOpen(true);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <SetupContext.Provider value={setup}>
      <SettingsContent local={local} onAdd={() => setWizard(true)} onGenerate={() => void generate()} />
      <Wizard open={wizard} onClose={() => setWizard(false)} onAdded={setSetup} onRunStarted={(id) => { setRunId(id); setRunOpen(true); }} />
      <RunDialog runId={runId} open={runOpen} onClose={() => setRunOpen(false)} onFinished={refresh} onApply={(preview) => void generate(preview)} />
    </SetupContext.Provider>
  );
}
