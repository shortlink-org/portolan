import { useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import {
  buildHref,
  buildInfo,
  buildLabel,
  buildTitle,
} from "../lib/build-info";
import { relativeTime } from "../lib/format";

const BOX =
  "mono flex items-center gap-1.5 rounded-control border px-2 py-1.5 border-line text-muted";

/**
 * What is deployed, and where to go to see it: the run that built this bundle,
 * or the commit it was built from when nobody built it but you.
 *
 * `bare` drops the box. In the top bar the stamp is one control among five and
 * needs an edge to be one of them; pinned to the foot of the sidebar it is the
 * last line of a list, and a bordered pill there reads as a button.
 */
export function BuildStamp({ bare = false }: { bare?: boolean }) {
  const [, force] = useState(0);

  // The stamp reads as relative time; nudge it once a minute.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // The stamp names a commit, so it opens the commit; the run that built it
  // is one click further, in the checks on that page.
  const href = buildHref();
  const box = bare
    ? "mono flex min-w-0 items-center gap-1.5 rounded-control px-1 py-0.5 text-muted"
    : BOX;
  const body = (
    <>
      <GitCommitHorizontal
        size={bare ? 14 : 16}
        aria-hidden
        className="shrink-0"
      />
      {buildLabel()}
      {buildInfo.builtAt && (
        <>
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          {relativeTime(buildInfo.builtAt)}
        </>
      )}
    </>
  );

  if (!href)
    return (
      <span className={box} title={buildTitle()}>
        {body}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={buildTitle()}
      className={`${box} transition-colors hover:bg-surface ${bare ? "hover:text-ink" : "hover:border-line-strong hover:text-ink"}`}
    >
      {body}
    </a>
  );
}
