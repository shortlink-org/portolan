import { useEffect, useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { GitCommitHorizontal } from "lucide-react";
import {
  buildHref,
  buildInfo,
  buildLabel,
  buildTitle,
} from "../lib/build-info";
import { absoluteTime, relativeTime } from "../lib/format";

const BOX =
  "mono flex items-center gap-1.5 rounded-control border px-2 py-1.5 border-line text-muted";

/**
 * What is deployed, and where to go to see it: the run that built this bundle,
 * or the commit it was built from when nobody built it but you. It is stamped
 * once, in the top bar, where it is one control among five and its border
 * makes it one of them; a second copy in the sidebar said nothing new.
 *
 * `compact` is the phone form: the icon alone, and everything the wide stamp
 * says in line - the commit, when it was built, the branch and the run - behind
 * a tap. The stamp is not a control a reader reaches for often enough to spend
 * a fifth of a phone's top bar on, but it is the one they reach for when they
 * are asking "is what I am looking at the build I think it is", and a title
 * attribute is not an answer on a device with no pointer to hover.
 */
export function BuildStamp({ compact = false }: { compact?: boolean }) {
  const [, force] = useState(0);

  // The stamp reads as relative time; nudge it once a minute.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // The stamp names a commit, so it opens the commit; the run that built it
  // is one click further, in the checks on that page.
  const href = buildHref();

  if (compact) return <CompactStamp href={href} />;

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
      className={`${BOX} transition-colors hover:border-line-strong hover:bg-surface hover:text-ink`}
    >
      {body}
    </a>
  );
}

function CompactStamp({ href }: { href: string | null }) {
  return (
    <Popover className="shrink-0">
      <PopoverButton
        aria-label={`Build — ${buildTitle()}`}
        title={buildTitle()}
        className={({ open }) =>
          `flex size-8 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${
            open ? "text-accent" : "text-muted hover:text-ink"
          }`
        }
      >
        <GitCommitHorizontal size={16} aria-hidden />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 w-64 rounded-control border bg-canvas p-2 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label mb-1.5 px-1">build</div>
        <dl className="mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-1 text-muted">
          <dt>commit</dt>
          {/* `buildLabel` ends a dirty tree in a "+", which is what the wide
              stamp has room to say. Here the word says it, so the sign would
              be saying it twice. */}
          <dd className="truncate text-ink">
            {buildInfo.shortCommit || buildLabel()}
            {buildInfo.dirty ? (
              <span className="ml-1.5 text-muted">uncommitted</span>
            ) : null}
          </dd>
          {buildInfo.branch ? (
            <>
              <dt>branch</dt>
              <dd className="truncate text-ink">{buildInfo.branch}</dd>
            </>
          ) : null}
          {buildInfo.buildNumber ? (
            <>
              <dt>run</dt>
              <dd className="truncate text-ink">#{buildInfo.buildNumber}</dd>
            </>
          ) : null}
          <dt>built</dt>
          <dd className="text-ink">
            {buildInfo.builtAt ? (
              <>
                {relativeTime(buildInfo.builtAt)}
                <div className="text-muted">
                  {absoluteTime(buildInfo.builtAt)}
                </div>
              </>
            ) : (
              "at an unrecorded time"
            )}
          </dd>
        </dl>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mono mt-2 block rounded-control px-1 py-1 text-accent hover:bg-surface"
          >
            open on the forge ↗
          </a>
        ) : null}
      </PopoverPanel>
    </Popover>
  );
}
