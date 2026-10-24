import { Check, Circle } from "lucide-react";
import { useParams } from "react-router";
import type { SpecHistoryEntry } from "virtual:portolan-spec-history";
import type { ChangeSpec, SpecArtifact } from "../catalog";
import { useDocumentTitle } from "../app/title";
import { Ident } from "../components/Ident";
import { Markdown } from "../components/Markdown";
import { SectionTitle } from "../components/PageHeader";
import { catalog, index, specificationHistory } from "../data";
import { NotFound } from "./NotFound";
import { DraftBanner } from "../drafts/DraftBanner";
import { usePickedDraft } from "../drafts/store";
import type { PathImpact } from "../lib/path-impact";
import { SpecReference, SpecReferenceText } from "../components/SpecReference";
import { knownSpecPaths, unresolvedSpecReferences } from "../lib/spec-references";
import type { SpecReferenceContext } from "../lib/spec-references";
import { paths, specRequirementAnchor, specScenarioAnchor, specTaskAnchor } from "../routes";
import { ActivityFeed } from "../components/ActivityFeed";
import { projectSpecActivity } from "../lib/spec-activity";
import type { Change } from "../lib/catalog-diff";
import { pathForId } from "../app/canonical";

function Artifact({ artifact, references }: { artifact: SpecArtifact; references: SpecReferenceContext }) {
  return (
    <section>
      <SectionTitle right={<span className="mono text-muted">{artifact.path}</span>}>
        {artifact.kind}
      </SectionTitle>
      <div className="prose-surface"><Markdown mermaid inlineCode={(value) => <SpecReference value={value} context={references} />}>{artifact.body}</Markdown></div>
    </section>
  );
}

function activitySubjectHref(spec: ChangeSpec, change: Change): string | undefined {
  if (change.kind.startsWith("task.")) {
    const id = change.where.split("#task:")[1];
    return id ? `#${specTaskAnchor(id)}` : undefined;
  }
  if (change.kind.startsWith("requirement.") || change.kind.startsWith("scenario.")) {
    const [id, scenarioName] = change.where.split("#scenario:");
    const requirement = spec.requirements.find((candidate) => candidate.id === id);
    if (!requirement) return undefined;
    if (change.kind.startsWith("scenario.") && scenarioName && requirement.scenarios.some((scenario) => scenario.name === scenarioName)) {
      return `#${specScenarioAnchor(id!, scenarioName)}`;
    }
    return `#${specRequirementAnchor(id!)}`;
  }
  if (change.kind.startsWith("spec.")) return paths.spec(spec.slug);
  return pathForId(index, change.where);
}

export function SpecDetailView({ spec, previous, history = [], impact = [], draftId }: { spec: ChangeSpec; previous?: ChangeSpec; history?: SpecHistoryEntry[]; impact?: readonly PathImpact[]; draftId?: string }) {
  const done = spec.tasks.filter((task) => task.done).length;
  const narrative = spec.artifacts.filter(
    (artifact) => artifact.kind === "proposal" || artifact.kind === "design",
  );
  const references = { spec, index, knownPaths: knownSpecPaths(spec) } satisfies SpecReferenceContext;
  const unresolved = unresolvedSpecReferences(spec, references);
  const activity = projectSpecActivity({
    spec,
    previous,
    history,
    impact,
    hrefForCatalogId: (id) => pathForId(index, id),
    hrefForSpecSubject: (change) => activitySubjectHref(spec, change),
  });

  return (
    <div className="h-full overflow-y-auto">
      {draftId ? <DraftBanner id={draftId} className="mx-gutter mt-3" /> : null}
      <header className="border-b border-line px-gutter py-5">
        <div className="label">{spec.format} specification</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="text-md font-semibold">{spec.title}</h1>
          <span className="chip border-line-strong">{spec.lifecycle}</span>
        </div>
        <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
          <Ident value={spec.id} />
          <span>{spec.source}</span>
          <span>{spec.requirements.length} requirements</span>
          <span>{done} of {spec.tasks.length} tasks</span>
        </div>
        <p className="mt-3 max-w-prose text-sm text-muted">
          Checklist progress is author intent. It does not claim that code, runtime behavior, or the architecture catalog conforms to this specification.
        </p>
      </header>

      <div className="grid gap-section p-gutter xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-section">
          {narrative.map((artifact) => <Artifact key={artifact.path} artifact={artifact} references={references} />)}
          <section>
            <SectionTitle right={<span className="mono text-muted">{spec.requirements.length}</span>}>
              Requirements
            </SectionTitle>
            <div className="flex flex-col gap-3">
              {spec.requirements.map((requirement) => (
                <article id={specRequirementAnchor(requirement.id)} key={requirement.id} className="scroll-mt-4 overflow-hidden rounded-card border border-line">
                  <div className="border-b border-line bg-surface px-4 py-3">
                    <h3 className="font-medium"><SpecReferenceText context={references}>{requirement.title}</SpecReferenceText></h3>
                    <div className="mono mt-1 text-muted">{requirement.source}</div>
                  </div>
                  <div className="p-4">
                    {requirement.text ? <Markdown inlineCode={(value) => <SpecReference value={value} context={references} />}>{requirement.text}</Markdown> : null}
                    {requirement.scenarios.map((scenario) => (
                      <div id={specScenarioAnchor(requirement.id, scenario.name)} key={scenario.name} className="scroll-mt-4 mt-4 border-l-2 border-accent pl-3">
                        <h4 className="font-medium"><SpecReferenceText context={references}>{scenario.name}</SpecReferenceText></h4>
                        {scenario.when.map((line) => <div key={`when:${line}`} className="mt-2 text-sm"><span className="label mr-2">WHEN</span><SpecReferenceText context={references}>{line}</SpecReferenceText></div>)}
                        {scenario.then.map((line) => <div key={`then:${line}`} className="mt-1 text-sm"><span className="label mr-2">THEN</span><SpecReferenceText context={references}>{line}</SpecReferenceText></div>)}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <ActivityFeed events={activity} />
          {activity.length > 0 ? <div className="mt-section" /> : null}
          <SectionTitle right={<span className="mono text-muted">{done}/{spec.tasks.length}</span>}>
            Tasks
          </SectionTitle>
          <ol className="overflow-hidden rounded-card border border-line">
            {spec.tasks.map((task) => (
              <li id={specTaskAnchor(task.id)} key={task.id} className="scroll-mt-4 flex gap-2 border-b border-line p-3 last:border-b-0">
                {task.done ? <Check size={15} className="mt-0.5 shrink-0 text-status-verified" aria-label="done" /> : <Circle size={15} className="mt-0.5 shrink-0 text-muted" aria-label="open" />}
                <div className="min-w-0">
                  <div className={task.done ? "text-muted line-through" : ""}><span className="mono mr-2">{task.id}</span><SpecReferenceText context={references}>{task.title}</SpecReferenceText></div>
                  <div className="mono mt-1 text-muted">{task.source}</div>
                </div>
              </li>
            ))}
          </ol>
          {unresolved.length > 0 ? (
            <section className="mt-section">
              <SectionTitle right={<span className="mono text-unresolved">{unresolved.length}</span>}>Unresolved references</SectionTitle>
              <div className="overflow-hidden rounded-card border border-unresolved/30">
                {unresolved.map((reference) => (
                  <div key={`${reference.kind}:${reference.raw}`} className="border-b border-line px-3 py-2 last:border-b-0">
                    <code className="text-unresolved">{reference.raw}</code>
                    <div className="mt-1 text-xs text-muted">{reference.status === "unresolved" ? reference.reason : ""}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export function SpecDetail() {
  const { spec: slug } = useParams();
  const spec = (catalog.specs ?? []).find((candidate) => candidate.slug === slug);
  const picked = usePickedDraft(spec?.id ?? "");
  useDocumentTitle(spec?.title ?? "Specification not found");
  if (!spec) return <NotFound kind="specification" id={slug} />;
  const shown = (picked?.entity.versions.branch ?? spec) as ChangeSpec;
  return <SpecDetailView spec={shown} previous={picked?.entity.versions.base as ChangeSpec | undefined} history={picked ? [] : specificationHistory[spec.id] ?? []} impact={picked?.draft.impact ?? []} draftId={spec.id} />;
}
