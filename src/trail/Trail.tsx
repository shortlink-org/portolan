// The trail, as a strip under the top bar.
//
// It is chrome, so it is quiet: one row, no borders around the chips, the
// icons doing the work of saying what each name is. The page the reader is on
// is in the row too, dimmed and not a link — it is there so the strip does not
// shift under them on every move, not as somewhere to go.

import { useMemo } from "react";
import { History } from "lucide-react";
import { Link, useLocation } from "react-router";
import { KindIcon } from "../components/kind";
import { KIND_LABEL } from "../lib/kinds";
import { useNarrow } from "../app/responsive";
import { visitSubject, visitTo } from "./model";
import { useTrailStore } from "./store";

const CHIP = "mono flex shrink-0 items-center gap-1.5 rounded-control px-1.5 py-px";

export function Trail() {
  const visits = useTrailStore((s) => s.visits);
  const { pathname } = useLocation();
  const narrow = useNarrow();

  // Entities the catalog has since dropped leave the strip rather than
  // offering a link to a page that is not there any more.
  const chips = useMemo(
    () =>
      visits.flatMap((visit) => {
        const subject = visitSubject(visit);
        return subject ? [{ visit, subject }] : [];
      }),
    [visits],
  );

  // One chip is not a trail, it is the page the reader is already looking at;
  // and below the breakpoint the shell has no rows to spare.
  if (narrow || chips.length < 2) return null;

  return (
    <nav
      aria-label="Recently visited"
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-gutter border-line bg-canvas"
    >
      <History
        size={13}
        aria-hidden
        className="mr-1 shrink-0 text-line-strong"
      />
      {chips.map(({ visit, subject }) =>
        visit.path === pathname ? (
          <span
            key={visit.path}
            aria-current="page"
            className={`${CHIP} text-muted opacity-50`}
          >
            <KindIcon
              kind={subject.kind}
              contextId={subject.contextId}
              size={13}
            />
            {subject.label}
          </span>
        ) : (
          <Link
            key={visit.path}
            to={visitTo(visit)}
            title={`${KIND_LABEL[subject.kind]} — ${subject.label}`}
            className={`${CHIP} text-muted t-micro transition-colors hover:bg-surface hover:text-ink`}
          >
            <KindIcon
              kind={subject.kind}
              contextId={subject.contextId}
              size={13}
            />
            {subject.label}
          </Link>
        ),
      )}
    </nav>
  );
}
