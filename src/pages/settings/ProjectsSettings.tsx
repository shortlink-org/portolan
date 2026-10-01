import { Link } from "react-router";
import { Check, ChevronDown, FolderGit2, GitBranch, Plus, Trash2 } from "lucide-react";
import { catalog, catalogSources } from "../../data";
import { plural } from "../../lib/format";
import type { SetupProject } from "../../lib/setup-info";
import { bare, treeHref } from "../../lib/source-link";
import { paths } from "../../routes";
import { SectionTitle } from "../../components/PageHeader";
import { CatEmptyState, CatIllustration } from "../../components/CatIllustration";
import { CommitLink } from "../../components/CommitLink";
import { starterProject, useSetup } from "./setup";
import type { ProjectSource } from "./setup";
import { healthFor, HealthBadge } from "./health";
import { FileLink, PipelineSteps } from "./PipelineSteps";

function projectHref(project: SetupProject): string | null {
  const group = project.group ?? project.context;
  if (project.components?.length) return group && catalog.contexts.some((item) => item.id === group) ? paths.context(group) : null;
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

function ProjectCard({ project, onRemove }: { project: SetupProject; onRemove?: (project: SetupProject) => void }) {
  const setupInfo = useSetup();
  const declared = setupInfo.steps.filter((step) => step.projectId === project.id);
  const runSteps = setupInfo.run?.steps.filter((step) => step.projectId === project.id) ?? [];
  const pluginNames = [...new Set(declared.map((step) => step.plugin))];
  // A project rooted at the repository itself owns every source in it.
  const rootedAtRepository = project.root === "." || project.root === "";
  const sources = catalogSources.filter(
    (source) => rootedAtRepository || source.path === project.root || source.path.startsWith(`${project.root}/`),
  );
  const outputs = [...new Set(runSteps.flatMap((step) => step.files))];
  // A vendored project's provenance is its pin: the upstream commit the copy
  // was fetched at, which is also what its source links open. The history of
  // THIS checkout says when the copy landed here, which is a different fact.
  const pin = project.repository
    ? catalog.repos?.find((held) => bare(held.repo) === bare(project.repository!))
    : undefined;
  const commits = [...new Set(sources.map((source) => source.commit).filter(Boolean))];
  // "uncommitted" is what the history says of a file it does not hold yet;
  // it is not a commit, and a link built from it would open nothing.
  const committed = commits.filter((commit) => commit !== "uncommitted");
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
        {onRemove ? (
          <button
            type="button"
            className="tbtn shrink-0 p-1.5 text-unresolved"
            onClick={() => onRemove(project)}
            aria-label={`Remove ${project.name}`}
            title={`Remove ${project.name}`}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        ) : null}
      </div>

      <dl className="mono mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-muted">
        <dt>scope</dt>
        <dd className="truncate text-ink">
          {project.components?.length
            ? `${project.group ?? project.context} · ${project.components.length} components`
            : [project.group ?? project.context, project.component ?? project.service].filter(Boolean).join(" · ") || "estate"}
        </dd>
        <dt>pipeline</dt><dd className="text-ink">{declared.length} {plural(declared.length, "step")}</dd>
        <dt>fragments</dt><dd className="text-ink">{sources.length}</dd>
        <dt>commit</dt>
        <dd className="truncate text-ink" title={pin ? pin.commit : commits.join(", ")}>
          {pin
            ? <CommitLink commit={pin.commit} repository={project.repository} length={12} />
            : committed.length === 1
              ? <CommitLink commit={committed[0]!} repository={project.repository} length={12} />
              : committed.length > 1
                ? `${committed.length} source commits`
                : commits.length > 0
                  ? "uncommitted"
                  : "not stamped"}
        </dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Active plugins">
        {pluginNames.map((name) => (
          <Link key={name} to={`${paths.settingsPipeline()}#plugin-${name}`} className="chip border-line-strong hover:border-accent hover:text-accent">
            {name}
          </Link>
        ))}
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
            {sources.length > 0 ? (
              <ul className="mono space-y-1 text-muted">
                {sources.map((source) => <li key={source.path} className="truncate"><FileLink path={source.path} /></li>)}
              </ul>
            ) : (
              <p className="mono text-muted">No catalog fragments found under this root.</p>
            )}
          </div>
          {outputs.length > 0 ? (
            <div>
              <div className="label mb-2">generated outputs</div>
              <ul className="mono space-y-1 text-muted">
                {outputs.map((output) => <li key={output} className="truncate"><FileLink path={output} /></li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function AddProjectCard({ onAdd }: { onAdd: (source: ProjectSource) => void }) {
  return (
    <article className="rounded-card border border-line bg-canvas p-card shadow-xs xl:col-span-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-accent">
          <Plus size={19} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">Add a project</div>
          <p className="mt-1 text-muted">Connect a local folder or Git repository. Portolan will detect the right extractors.</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button type="button" className="tbtn px-3 py-1.5" onClick={() => onAdd("local")}>
            <FolderGit2 size={15} aria-hidden /> Local folder
          </button>
          <button type="button" className="product-primary" onClick={() => onAdd("external")}>
            <GitBranch size={15} aria-hidden /> Git repository
          </button>
        </div>
      </div>
    </article>
  );
}

function OnboardingCard({ starter, onAdd, onRemove }: { starter?: SetupProject; onAdd: (source: ProjectSource) => void; onRemove: (project: SetupProject) => void }) {
  return (
    <article className="mb-grid overflow-hidden rounded-card border border-accent bg-canvas shadow-xs">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-surface px-card py-3">
        <div>
          <div className="font-semibold text-ink">Start with your architecture</div>
          <p className="mt-1 text-muted">Replace the starter catalog with the project you actually want to describe.</p>
        </div>
        <CatIllustration scene="onboarding" className="cat-onboarding-illustration" />
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="flex items-start gap-3 p-card md:border-r md:border-line">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-canvas">
            <Plus size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">Add your first project</span>
              <span className="chip status-verified">recommended</span>
            </div>
            <p className="mt-1 text-muted">A successful trial replaces the starter and adds your project in one reviewed change.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="product-primary" onClick={() => onAdd("local")}>
                <FolderGit2 size={14} aria-hidden /> Local folder
              </button>
              <button type="button" className="tbtn" onClick={() => onAdd("external")}>
                <GitBranch size={14} aria-hidden /> Git repository
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3 p-card">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${starter ? "bg-surface text-muted" : "bg-verified text-canvas"}`}>
            {starter ? <Trash2 size={14} aria-hidden /> : <Check size={15} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink">Or start with an empty catalog</div>
            <p className="mt-1 text-muted">Remove the starter now if you want to connect projects later. Application source code is never touched.</p>
            {starter ? (
              <button type="button" className="tbtn mt-3 text-unresolved" onClick={() => onRemove(starter)}>
                <Trash2 size={14} aria-hidden /> Remove starter only
              </button>
            ) : (
              <div className="mono mt-2 text-verified">starter removed</div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProjectsSettings({ local, onAdd, onRemove }: { local: boolean; onAdd: (source: ProjectSource) => void; onRemove: (project: SetupProject) => void }) {
  const setupInfo = useSetup();
  const starter = starterProject(setupInfo);
  return (
    <section>
      <SectionTitle
        right={local ? (
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">editable in local mode</span>
            <button type="button" className="tbtn text-ink" onClick={() => onAdd("local")}>
              <Plus size={14} aria-hidden /> Add project
            </button>
          </div>
        ) : "declared in portolan.json"}
      >
        Projects
      </SectionTitle>
      {local && (starter || setupInfo.projects.length === 0) ? <OnboardingCard starter={starter} onAdd={onAdd} onRemove={onRemove} /> : null}
      {setupInfo.projects.length === 0 && !local ? (
        <CatEmptyState scene="onboarding" title="No projects connected">
          portolan.json names no projects — every input here is the estate's own.
        </CatEmptyState>
      ) : (
        <div className="grid gap-grid xl:grid-cols-2">
          {setupInfo.projects.map((project) => (
            <ProjectCard key={project.id} project={project} onRemove={local ? onRemove : undefined} />
          ))}
          {local ? <AddProjectCard onAdd={onAdd} /> : null}
        </div>
      )}
    </section>
  );
}
