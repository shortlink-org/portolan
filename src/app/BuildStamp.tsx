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
 */
export function BuildStamp() {
  const [, force] = useState(0);

  // The stamp reads as relative time; nudge it once a minute.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // The stamp names a commit, so it opens the commit; the run that built it
  // is one click further, in the checks on that page.
  const href = buildHref();
  const body = (
    <>
      <GitCommitHorizontal size={16} aria-hidden className="shrink-0" />
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
      <span className={BOX} title={buildTitle()}>
        {body}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={buildTitle()}
      className={`${BOX} transition-colors hover:bg-surface hover:border-line-strong hover:text-ink`}
    >
      {body}
    </a>
  );
}
