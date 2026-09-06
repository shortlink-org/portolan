// What the panel shows before the first question.
//
// Two lines on what it can do, and four questions this catalog can answer,
// drawn as rows the way the palette draws its results - a list to pick from,
// not a stack of buttons.

import { KindIcon } from "../components/kind";
import type { Kind } from "../lib/kinds";
import { catalog } from "../data";

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

export function Starter({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="pt-1">
      <p className="text-muted">
        Answers are read from the catalog's own pages, and every id in them is a
        link. Ask about a service, a flow, a decision, or what stands between two
        contexts.
      </p>
      <div className="label mt-5 mb-1">try one</div>
      <ul className="-mx-1">
        {examples().map((example) => (
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
