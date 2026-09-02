import { Link } from "react-router";
import type { ReactNode } from "react";
import type {
  Adr,
  AdrScope,
  AdrStatus,
  Classification,
  Status,
} from "../catalog";
import { index } from "../data";
import { adrNumber } from "../lib/adr";
import { ctxStyle } from "../lib/context-color";
import { paths } from "../routes";

export const STATUS_LABEL: Record<Status, string> = {
  verified: "verified",
  declared: "declared",
  unresolved: "unresolved",
};

/** Component class that paints text and border for a status. */
export const STATUS_CLASS: Record<Status, string> = {
  verified: "status-verified",
  declared: "status-declared",
  unresolved: "status-unresolved",
};

/**
 * Written out rather than composed, because Tailwind scans source text for
 * class names: `text-${status}` would never be generated.
 */
export const STATUS_TEXT: Record<Status, string> = {
  verified: "text-verified",
  declared: "text-declared",
  unresolved: "text-unresolved",
};

/** Raw value, for SVG strokes and React Flow edges that cannot take a class. */
export function statusVar(status: Status): string {
  return `var(--status-${status})`;
}

export function StatusChip({
  status,
  title,
}: {
  status: Status;
  title?: string;
}) {
  return (
    <span
      title={title ?? `status: ${status}`}
      className={`chip ${STATUS_CLASS[status]}`}
    >
      <span aria-hidden className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ContextPill({ id, name }: { id: string; name?: string }) {
  return (
    <span className="chip ctx" style={ctxStyle(id)}>
      <span aria-hidden className="dot" />
      {name ?? id}
    </span>
  );
}

/**
 * How strategically a bounded context is rated, said in one word. Core is the
 * only one worth the accent - "supporting" and "generic" are the answer "not
 * where the value is", and a row full of loud badges says nothing at all.
 */
const CLASSIFICATION_META: Record<
  Classification,
  { className: string; title: string }
> = {
  core: {
    className: "border-accent text-accent",
    title: "core domain - where this estate competes",
  },
  supporting: {
    className: "border-line-strong text-muted",
    title: "supporting domain - needed here, but not a differentiator",
  },
  generic: {
    className: "border-line-strong text-muted",
    title: "generic domain - a solved problem, bought or borrowed",
  },
};

/**
 * The classification badge, and the only place it is drawn. A context with no
 * classification renders nothing: an unrated domain is not a "generic" one, and
 * a placeholder would state a call the estate has not made.
 *
 * `tiny` is the sidebar's 10px variant, where the badge rides at the end of a
 * tree row and must not compete with the context name it annotates.
 */
export function ClassificationBadge({
  classification,
  tiny = false,
}: {
  classification?: Classification;
  tiny?: boolean;
}) {
  if (!classification) return null;
  const meta = CLASSIFICATION_META[classification];
  return (
    <span
      className={`chip shrink-0 ${meta.className}`}
      style={tiny ? { fontSize: 10, lineHeight: "14px" } : undefined}
      title={meta.title}
    >
      {classification}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Decision records
// ---------------------------------------------------------------------------

/**
 * Green for what holds, amber for what is still being argued, grey for what is
 * only history. Grey covers three different endings, so the badge says which.
 */
const ADR_STATUS_CLASS: Record<AdrStatus, string> = {
  accepted: "status-verified",
  proposed: "status-declared",
  superseded: "border-line-strong text-muted",
  deprecated: "border-line-strong text-muted",
  rejected: "border-line-strong text-muted",
};

/** True for records that are no longer in force; their number is struck out. */
export function isStruck(status: AdrStatus): boolean {
  return status === "superseded" || status === "deprecated";
}

export function AdrStatusChip({ status }: { status: AdrStatus }) {
  return (
    <span
      title={`status: ${status}`}
      className={`chip ${ADR_STATUS_CLASS[status]}`}
    >
      <span aria-hidden className="dot" />
      {status}
    </span>
  );
}

/** "ADR-0007", struck through once the decision no longer holds. */
export function AdrNumber({
  adr,
  className = "",
}: {
  adr: Adr;
  className?: string;
}) {
  const struck = isStruck(adr.status);
  return (
    <span
      className={`mono ${struck ? "line-through text-muted" : ""} ${className}`}
      title={struck ? `${adr.id} - no longer in force` : adr.id}
    >
      {adrNumber(adr)}
    </span>
  );
}

/**
 * The scope a decision was taken at, linking to the page it governs. Pass
 * `link={false}` inside a row that is itself a link: an anchor cannot contain
 * another one.
 */
export function AdrScopePill({
  scope,
  link = true,
}: {
  scope: AdrScope;
  link?: boolean;
}) {
  if (scope.kind === "org") {
    return (
      <span className="chip border-line-strong text-muted" title="org-wide">
        <span aria-hidden className="dot" />
        org
      </span>
    );
  }

  if (scope.kind === "context") {
    const body = (
      <>
        <span aria-hidden className="dot" />
        {scope.context}
      </>
    );
    const props = {
      className: "chip ctx",
      style: ctxStyle(scope.context),
      title: `context ${scope.context}`,
    };
    return link ? (
      <Link to={paths.context(scope.context)} {...props}>
        {body}
      </Link>
    ) : (
      <span {...props}>{body}</span>
    );
  }

  const context = index.serviceContext.get(scope.service);
  const service = index.serviceById.get(scope.service);
  if (!context || !service) {
    return (
      <span className="chip status-unresolved">
        <span aria-hidden className="dot" />
        {scope.service}
      </span>
    );
  }
  const body = (
    <>
      <span aria-hidden className="dot" />
      {scope.service}
    </>
  );
  const props = {
    className: "chip ctx",
    style: ctxStyle(context.id),
    title: `service ${scope.service}`,
  };
  return link ? (
    <Link to={paths.service(context.id, service.slug)} {...props}>
      {body}
    </Link>
  ) : (
    <span {...props}>{body}</span>
  );
}

export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs">
      <h2 className="label border-b border-line bg-surface px-4 py-2">
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ExternalLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className="mono rounded-control text-accent hover:underline">
      {children}
    </Link>
  );
}
