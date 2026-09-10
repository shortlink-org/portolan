// What the panel shows before the first question.
//
// Two lines on what it can do, and four questions this catalog can answer,
// drawn as rows the way the palette draws its results - a list to pick from,
// not a stack of buttons.

import { KindIcon } from "../components/kind";
import type { Kind } from "../lib/kinds";
import { activeCatalogDocs, catalog } from "../data";
import type { ChatPageContext } from "./page-context";
import { contextQuestions } from "./page-context";

interface Example {
  kind: Kind;
  contextId?: string;
  question: string;
}

/** Questions this catalog can answer, built from what it has. */
function examples(): Example[] {
  const contexts = catalog.contexts.map((c) => c.id);
  const flow = catalog.flows[0];
  const out: Example[] = [];
  if (contexts.length >= 2 && contexts[0]) {
    out.push({
      kind: "context",
      contextId: contexts[0],
      question: `What runs between ${contexts[0]} and ${contexts[1]}?`,
    });
  }
  if (contexts[1])
    out.push({ kind: "event", question: `Which events does ${contexts[1]} consume?` });
  if (flow) out.push({ kind: "flow", question: `Show the "${flow.name}" flow` });
  if (contexts[0])
    out.push({ kind: "adr", question: `Which decisions touch ${contexts[0]}?` });
  return out;
}

export function Starter({
  onAsk,
  page,
}: {
  onAsk: (question: string) => void;
  page?: ChatPageContext | null;
}) {
  const choices: Example[] = page
    ? contextQuestions(page).map((question) => ({
        kind: page.kind,
        question,
      }))
    : examples();

  return (
    <div className="pt-1">
      <p className="text-muted">
        Answers are read from the catalog's own pages, and every id in them is a
        link. Ask about a service, a flow, a decision, or what stands between two
        contexts.
      </p>
      {page ? (
        <div className="mt-4 rounded-card border border-line bg-surface px-3 py-2.5 shadow-xs">
          <div className="flex min-w-0 items-start gap-2.5">
            <KindIcon
              kind={page.kind}
              size={16}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="label">current page</div>
              <div className="mt-0.5 truncate font-medium text-ink" title={page.title}>
                {page.title}
              </div>
              <div className="mono truncate text-muted" title={page.id}>{page.id}</div>
            </div>
          </div>
          {activeCatalogDocs ? <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-muted">
            <span className="text-faint">model context</span>
            <a
              href={activeCatalogDocs.index}
              target="_blank"
              rel="noreferrer"
              className="rounded-control text-accent hover:underline"
            >
              llms.txt
            </a>
            {page.docPath ? (
              <a
                href={`${activeCatalogDocs.pages}${page.docPath}`}
                target="_blank"
                rel="noreferrer"
                className="max-w-full truncate rounded-control text-accent hover:underline"
                title={page.docPath}
              >
                current catalog page
              </a>
            ) : null}
          </div> : null}
        </div>
      ) : null}
      <div className="label mt-5 mb-1">try one</div>
      <ul className="-mx-1">
        {choices.map((example) => (
          <li key={example.question}>
            <button
              type="button"
              onClick={() => onAsk(example.question)}
              className="flex w-full items-center gap-2.5 rounded-control border-l-2 border-transparent px-2 py-1.5 text-left text-ink transition-colors hover:border-accent hover:bg-raised"
            >
              <KindIcon
                kind={example.kind}
                {...(example.contextId ? { contextId: example.contextId } : {})}
                size={15}
                className="shrink-0"
              />
              <span className="min-w-0 truncate">{example.question}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
