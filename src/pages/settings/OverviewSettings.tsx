import { Link } from "react-router";
import { Check, CircleAlert, Play } from "lucide-react";
import { catalogSources } from "../../data";
import { absoluteTime, plural, relativeTime } from "../../lib/format";
import { paths } from "../../routes";
import { starterProject, useSetup } from "./setup";
import { duration, HealthBadge } from "./health";
import type { Health } from "./health";

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-canvas px-3 py-2 shadow-xs">
      <span className="tnum text-lg font-semibold text-ink">{value}</span>
      <span className="mono ml-2 text-muted">{plural(value, label)}</span>
    </div>
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

function GettingStarted({ onGenerate }: { onGenerate: () => void }) {
  const setupInfo = useSetup();
  const starter = starterProject(setupInfo);
  const ownProjects = starter ? [] : setupInfo.projects;
  const connected = ownProjects.length > 0;
  const placed = connected && ownProjects.some((project) => (project.group ?? project.context) && (project.component ?? project.service));
  const generated = placed && Boolean(setupInfo.run && !setupInfo.reportStale && setupInfo.run.status === "ok");
  const steps = [
    { label: "Clear the starter", detail: "Remove the placeholder project and catalog.", done: !starter },
    { label: "Connect a project", detail: placed ? "Project and architecture placement are configured." : "Choose a source and place it in a bounded context.", done: placed },
    { label: "Review the result", detail: "Preview and apply the generated documentation.", done: generated },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return null;
  const tip = starter
    ? "The starter is only configuration and generated catalog data. Removing it never touches application source code."
    : !connected
      ? "Start with one deployable component. A useful small catalog is easier to grow than a perfect estate-wide model."
      : !placed
        ? "A bounded context describes a language and responsibility boundary, not necessarily a directory or team."
        : "Preview first: Portolan shows the exact generated-file diff before anything is applied.";
  return (
    <section className="mb-section overflow-hidden rounded-card border border-accent bg-canvas shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface px-card py-3">
        <div>
          <div className="font-semibold text-ink">Getting started</div>
          <p className="mt-1 text-muted">One path from an empty workspace to useful architecture documentation.</p>
        </div>
        <div className="mono text-muted">{completed} / {steps.length} complete</div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,0.75fr)]">
        <ol className="divide-y divide-line lg:border-r lg:border-line">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-start gap-3 px-card py-3">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-verified text-canvas" : index === completed ? "bg-accent text-canvas" : "bg-surface text-muted"}`}>
                {step.done ? <Check size={14} aria-hidden /> : index + 1}
              </span>
              <span>
                <span className="font-medium text-ink">{step.label}</span>
                <span className="mt-0.5 block text-muted">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col justify-between gap-4 p-card">
          <div>
            <div className="label mb-2">tip for this step</div>
            <p className="text-muted">{tip}</p>
          </div>
          {starter || !placed ? (
            <Link to={paths.settingsProjects()} className="product-primary self-start">
              {starter ? "Replace starter" : "Add a project"}
            </Link>
          ) : (
            <button type="button" className="product-primary self-start" onClick={onGenerate}>
              <Play size={15} aria-hidden /> Preview generated diff
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function OverviewSettings({ local, onGenerate }: { local: boolean; onGenerate: () => void }) {
  const setupInfo = useSetup();
  const active = setupInfo.plugins.filter((plugin) => plugin.stepCount > 0);
  return (
    <>
      {local ? <GettingStarted onGenerate={onGenerate} /> : null}
      <BuildHealth />
      <div className="mt-4 grid grid-cols-2 gap-grid lg:grid-cols-4">
        <Metric value={setupInfo.projects.length} label="project" />
        <Metric value={active.length} label="active plugin" />
        <Metric value={setupInfo.steps.length} label="pipeline step" />
        <Metric value={catalogSources.length} label="catalog source" />
      </div>
      <div className="mt-section grid gap-grid sm:grid-cols-2">
        <Link to={paths.settingsProjects()} className="card">
          <div className="font-semibold text-ink">Projects</div>
          <p className="mt-1 text-muted">Sources, scopes and extraction coverage for {setupInfo.projects.length} {plural(setupInfo.projects.length, "project")}.</p>
        </Link>
        <Link to={paths.settingsPipeline()} className="card">
          <div className="font-semibold text-ink">Pipeline</div>
          <p className="mt-1 text-muted">Inspect {active.length} active {plural(active.length, "plugin")} and their generated outputs.</p>
        </Link>
        <Link to={paths.settingsDelivery()} className="card">
          <div className="font-semibold text-ink">Delivery</div>
          <p className="mt-1 text-muted">Install review checks and static catalog publishing for GitHub or GitLab.</p>
        </Link>
        <Link to={paths.settingsIntegrations()} className="card">
          <div className="font-semibold text-ink">Integrations</div>
          <p className="mt-1 text-muted">Connect operational tools such as Kafka UI to the catalog.</p>
        </Link>
        <Link to={paths.settingsPreferences()} className="card">
          <div className="font-semibold text-ink">Preferences</div>
          <p className="mt-1 text-muted">Theme, row density, source editor and Ask the catalog.</p>
        </Link>
      </div>
    </>
  );
}
