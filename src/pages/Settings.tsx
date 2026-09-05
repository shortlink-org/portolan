import { Link } from "react-router";
import {
  Box,
  Check,
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
import { plural } from "../lib/format";
import { setupInfo } from "../lib/setup-info";
import type {
  SetupPhase,
  SetupPlugin,
  SetupProject,
} from "../lib/setup-info";
import { treeHref } from "../lib/source-link";
import { paths } from "../routes";
import { Empty, SectionTitle } from "../components/PageHeader";

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-canvas px-3 py-2 shadow-xs">
      <span className="tnum text-lg font-semibold text-ink">{value}</span>
      <span className="mono ml-2 text-muted">{plural(value, label)}</span>
    </div>
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
  return service
    ? paths.service(context.id, service.slug)
    : paths.context(context.id);
}

/**
 * Where the project's source can be opened. A project in the repository this
 * was built from opens at its own directory, at the built commit. One that
 * names another repository opens at that repository instead: this build knows
 * neither its default branch nor what a root of ours means inside it, and a
 * link that 404s is worse than none.
 */
function forge(project: SetupProject): { href: string; title: string } | null {
  if (project.repository) {
    return {
      href: project.repository,
      title: "Open the project's repository",
    };
  }
  const tree = treeHref(project.root, null);
  return tree
    ? {
        href: tree,
        title: "Open the project's directory on the forge, at the built commit",
      }
    : null;
}

function ProjectCard({ project }: { project: SetupProject }) {
  const steps = setupInfo.steps.filter((step) => step.projectId === project.id);
  const pluginNames = [
    ...new Set(steps.map((step) => step.plugin)),
  ];
  const sources = catalogSources.filter(
    (source) =>
      source.path === project.root ||
      source.path.startsWith(`${project.root}/`),
  );
  const commits = [
    ...new Set(sources.map((source) => source.commit).filter(Boolean)),
  ];
  const href = projectHref(project);
  const sourceLink = forge(project);
  const title = <span className="font-semibold text-ink">{project.name}</span>;

  return (
    <article className="rounded-card border border-line bg-canvas p-card shadow-xs">
      <div className="flex items-start gap-3">
        <FolderGit2 size={18} aria-hidden className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {href ? (
              <Link to={href} className="rounded-control hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
            {sources.length > 0 ? (
              <span className="chip status-verified">
                <Check size={11} aria-hidden /> catalogued
              </span>
            ) : (
              <span className="chip status-declared">no fragments</span>
            )}
          </div>
          <div className="mono mt-0.5 flex items-center gap-2 text-muted">
            <span className="truncate" title={project.root}>
              {project.root}
            </span>
            {sourceLink ? (
              <a
                href={sourceLink.href}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-control text-accent hover:underline"
                title={sourceLink.title}
              >
                open ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <dl className="mono mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted">
        <dt>scope</dt>
        <dd className="text-ink">
          {[project.context, project.service].filter(Boolean).join(" · ") ||
            "estate"}
        </dd>
        <dt>pipeline</dt>
        <dd className="text-ink">
          {steps.length} {plural(steps.length, "step")}
        </dd>
        <dt>fragments</dt>
        <dd className="text-ink">{sources.length}</dd>
        <dt>commit</dt>
        <dd className="truncate text-ink" title={commits.join(", ")}>
          {commits.length === 0
            ? "not stamped"
            : commits.length === 1
              ? commits[0]
              : `${commits.length} source commits`}
        </dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Active plugins">
        {pluginNames.map((name) => (
          <span key={name} className="chip border-line-strong">
            {name}
          </span>
        ))}
      </div>
    </article>
  );
}

const PHASE_LABEL: Record<SetupPhase, string> = {
  extract: "extract",
  verify: "verify",
  generate: "generate",
};

function Runtime({ plugin }: { plugin: SetupPlugin }) {
  return plugin.runtime === "wasm" ? (
    <span className="inline-flex items-center gap-1.5 text-verified">
      <ShieldCheck size={14} aria-hidden /> WASM sandbox
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-declared">
      <Terminal size={14} aria-hidden /> host process
    </span>
  );
}

function PluginsTable() {
  if (setupInfo.plugins.length === 0) {
    return <Empty>this build ran no plugins</Empty>;
  }

  const projectNames = new Map(
    setupInfo.projects.map((project) => [project.id, project.name]),
  );

  return (
    <div className="overflow-x-auto rounded-card border border-line shadow-xs">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead className="label bg-surface">
          <tr>
            <th className="px-3 py-2 font-medium">plugin</th>
            <th className="px-3 py-2 font-medium">phase</th>
            <th className="px-3 py-2 font-medium">runtime</th>
            <th className="px-3 py-2 font-medium">used by</th>
            <th className="px-3 py-2 text-right font-medium">status</th>
          </tr>
        </thead>
        <tbody>
          {setupInfo.plugins.map((plugin) => {
            const names = plugin.projectIds
              .map((id) => projectNames.get(id) ?? id)
              .join(", ");
            return (
              <tr key={plugin.name} className="border-t border-line">
                <td className="mono px-3 py-2.5 text-ink">{plugin.name}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {plugin.phases.map((phase) => (
                      <span key={phase} className="chip">
                        {PHASE_LABEL[phase]}
                      </span>
                    ))}
                    {plugin.phases.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : null}
                  </span>
                </td>
                <td className="mono px-3 py-2.5">
                  <Runtime plugin={plugin} />
                </td>
                <td
                  className="px-3 py-2.5 text-muted"
                  title={names || undefined}
                >
                  {plugin.projectIds.length > 0
                    ? `${plugin.projectIds.length} ${plural(plugin.projectIds.length, "project")}`
                    : plugin.stepCount > 0
                      ? "estate"
                      : "—"}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {plugin.stepCount > 0 ? (
                    <span className="chip status-verified">active</span>
                  ) : (
                    <span className="chip text-muted">unused</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => theme !== "dark" && toggleTheme()}
            className={`flex items-center gap-1.5 ${theme === "dark" ? "is-on" : ""}`}
          >
            <Moon size={15} aria-hidden /> dark
          </button>
          <button
            type="button"
            aria-pressed={theme === "light"}
            onClick={() => theme !== "light" && toggleTheme()}
            className={`flex items-center gap-1.5 ${theme === "light" ? "is-on" : ""}`}
          >
            <Sun size={15} aria-hidden /> light
          </button>
        </div>
      </div>
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">row density</div>
        <div className="seg inline-flex" role="group" aria-label="Row density">
          <button
            type="button"
            aria-pressed={density === "comfortable"}
            onClick={() => density !== "comfortable" && toggleDensity()}
            className={`flex items-center gap-1.5 ${density === "comfortable" ? "is-on" : ""}`}
          >
            <Rows4 size={15} aria-hidden /> comfortable
          </button>
          <button
            type="button"
            aria-pressed={density === "compact"}
            onClick={() => density !== "compact" && toggleDensity()}
            className={`flex items-center gap-1.5 ${density === "compact" ? "is-on" : ""}`}
          >
            <Rows2 size={15} aria-hidden /> compact
          </button>
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
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="mt-1 max-w-prose text-muted">
              The projects, plugins and local preferences used by this catalog.
              Build configuration is read-only here and comes from portolan.json.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-grid lg:grid-cols-4">
          <Metric value={setupInfo.projects.length} label="project" />
          <Metric value={active.length} label="active plugin" />
          <Metric value={setupInfo.steps.length} label="pipeline step" />
          <Metric value={catalogSources.length} label="catalog source" />
        </div>

        <section className="mt-section">
          <SectionTitle right="declared in portolan.json">Projects</SectionTitle>
          {setupInfo.projects.length === 0 ? (
            <Empty>
              portolan.json names no projects — every input here is the
              estate's own
            </Empty>
          ) : (
            <div className="grid gap-grid xl:grid-cols-2">
              {setupInfo.projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-section">
          <SectionTitle
            right={`${active.length} of ${setupInfo.plugins.length} active`}
          >
            Plugins
          </SectionTitle>
          <PluginsTable />
          <p className="mono mt-2 text-muted">
            WASM runs without filesystem, network or environment access. A host
            process runs with the permissions of the build.
          </p>
        </section>

        <section className="mt-section">
          <SectionTitle right="stored in this browser">Appearance</SectionTitle>
          <Appearance />
        </section>

        <details className="mt-section rounded-card border border-line shadow-xs">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-ink">
            Advanced build inputs
          </summary>
          <div className="border-t border-line p-4">
            <div className="label mb-2">catalog source patterns</div>
            {setupInfo.sources.length === 0 ? (
              <Empty>no source patterns declared</Empty>
            ) : (
              <ul className="mono space-y-1 text-muted">
                {setupInfo.sources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            )}

            <div className="label mt-5 mb-2">pipeline</div>
            {setupInfo.steps.length === 0 ? (
              <Empty>no pipeline steps declared</Empty>
            ) : (
              <div className="space-y-1">
                {setupInfo.steps.map((step, index) => (
                  <div
                    key={`${step.phase}:${step.plugin}:${step.input ?? "catalog"}:${index}`}
                    className="mono grid gap-x-3 text-muted sm:grid-cols-[5rem_9rem_1fr]"
                  >
                    <span>{step.phase}</span>
                    <span className="text-ink">{step.plugin}</span>
                    <span
                      className="truncate"
                      title={step.input ?? "merged catalog"}
                    >
                      {step.input ?? "merged catalog"} → {step.output}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        <div className="mono mt-section flex items-center gap-2 pb-section text-muted">
          <Box size={14} aria-hidden />
          Configuration is embedded at build time; changing it requires a new
          catalog build.
        </div>
      </div>
    </div>
  );
}
