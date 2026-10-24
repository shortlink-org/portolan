import { Check, Circle } from "lucide-react";
import { useParams } from "react-router";
import type { SpecHistoryEntry } from "virtual:portolan-spec-history";
import type { ChangeSpec, SpecArtifact } from "../catalog";
import { useDocumentTitle } from "../app/title";
import { Ident } from "../components/Ident";
import { Markdown } from "../components/Markdown";
import { SectionTitle } from "../components/PageHeader";
import { catalog, index, specificationHistory } from "../data";
import { CommitLink } from "../components/CommitLink";
import { NotFound } from "./NotFound";
import { ChangedWith } from "../drafts/ChangedWith";
import { DraftBanner } from "../drafts/DraftBanner";
import { usePickedDraft } from "../drafts/store";
import type { PathImpact } from "../lib/path-impact";
import { SpecReference, SpecReferenceText } from "../components/SpecReference";
import { knownSpecPaths, unresolvedSpecReferences } from "../lib/spec-references";
import type { SpecReferenceContext } from "../lib/spec-references";
import { specRequirementAnchor, specTaskAnchor } from "../routes";

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

const unavailableReason = {
  "not-a-git-repository": "not inside a Git checkout",
  "uncommitted-only": "not committed yet",
  "shallow-history": "checkout history is shallow",
} as const;

function sourceAt(entry: SpecHistoryEntry): string | null {
  if (!entry.repository || !entry.latest?.commit) return null;
  const route = /gitlab/i.test(entry.repository) ? "/-/blob/" : "/blob/";
  const path = entry.source.split("/").map(encodeURIComponent).join("/");
  return `${entry.repository.replace(/\/$/, "")}${route}${encodeURIComponent(entry.latest.commit)}/${path}`;
}

function History({ entries }: { entries: SpecHistoryEntry[] }) {
  return (
    <section>
      <SectionTitle right={<span className="mono text-muted">{entries.length}</span>}>
        Git history
      </SectionTitle>
      <div className="overflow-hidden rounded-card border border-line">
        {entries.map((entry) => {
          const href = sourceAt(entry);
          return (
            <div key={entry.source} className="border-b border-line p-3 last:border-b-0">
              <div className="flex min-w-0 items-center gap-2">
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="mono min-w-0 truncate text-accent underline-offset-4 hover:underline" title={`${entry.source} at ${entry.latest?.commit}`}>
                    {entry.source}
                  </a>
                ) : <span className="mono min-w-0 truncate" title={entry.source}>{entry.source}</span>}
                {entry.uncommitted ? <span className="chip shrink-0">uncommitted</span> : null}
              </div>
              {entry.status === "available" && entry.first && entry.latest ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted">
                  <dt>first</dt>
                  <dd className="flex min-w-0 flex-wrap gap-x-2">
                    <CommitLink commit={entry.first.commit} repository={entry.repository} />
                    <span>{entry.first.author}</span>
                    <time dateTime={entry.first.date}>{entry.first.date.slice(0, 10)}</time>
                  </dd>
                  <dt>latest</dt>
                  <dd className="flex min-w-0 flex-wrap gap-x-2">
                    <CommitLink commit={entry.latest.commit} repository={entry.repository} />
                    <span>{entry.latest.author}</span>
                    <time dateTime={entry.latest.date}>{entry.latest.date.slice(0, 10)}</time>
                  </dd>
                </dl>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  History unavailable: {unavailableReason[entry.reason ?? "uncommitted-only"]}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SpecDetailView({ spec, history = [], impact = [], draftId }: { spec: ChangeSpec; history?: SpecHistoryEntry[]; impact?: readonly PathImpact[]; draftId?: string }) {
  const done = spec.tasks.filter((task) => task.done).length;
  const narrative = spec.artifacts.filter(
    (artifact) => artifact.kind === "proposal" || artifact.kind === "design",
  );
  const references = { spec, index, knownPaths: knownSpecPaths(spec) } satisfies SpecReferenceContext;
  const unresolved = unresolvedSpecReferences(spec, references);

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
                      <div key={scenario.name} className="mt-4 border-l-2 border-accent pl-3">
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
          <ChangedWith impact={impact} />
          {impact.length > 0 ? <div className="mt-section" /> : null}
          {history.length > 0 ? <><History entries={history} /><div className="mt-section" /></> : null}
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
  return <SpecDetailView spec={shown} history={picked ? [] : specificationHistory[spec.id] ?? []} impact={picked?.draft.impact ?? []} draftId={spec.id} />;
}
