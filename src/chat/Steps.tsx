// The pages an answer was read from, folded into one line.
//
// Three "read docs/…" rows above every answer were the loudest thing in the
// panel and the least read. One line says how many, and opens to the list
// for the reader who wants to check the model's sources - which is the whole
// point of having them.

import { ChevronRight, FileText } from "lucide-react";

const base = import.meta.env.BASE_URL;

export interface Read {
  path: string;
}

export function ReadSteps({ reads }: { reads: Read[] }) {
  if (reads.length === 0) return null;
  return (
    <details className="group">
      <summary className="mono flex cursor-pointer select-none items-center gap-1.5 text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={12}
          aria-hidden
          className="transition-transform group-open:rotate-90"
        />
        <FileText size={13} aria-hidden />
        sources · {reads.length} {reads.length === 1 ? "page" : "pages"}
      </summary>
      <ul className="mono mt-1 space-y-0.5 pl-6">
        {reads.map((read, index) => (
          <li key={`${read.path}:${index}`} className="truncate">
            <a
              href={`${base}${read.path}`}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {read.path}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
