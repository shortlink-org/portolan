import { Link } from "react-router";
import { AlertTriangle, Activity, FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import type { Adr, AdrScope, AdrStatus, Provenance, Status } from "../catalog";
import { index } from "../data";
import { adrNumber } from "../lib/adr";
import { ctxStyle } from "../lib/context-color";
import { absoluteTime, middleTruncate } from "../lib/format";
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

const PROVENANCE_META: Record<
  Provenance,
  {
    label: string;
    className: string;
    icon: typeof AlertTriangle;
    title: string;
  }
> = {
  authored: {
    label: "authored",
    className: "border-line-strong text-muted",
    icon: AlertTriangle,
    title: "Written by hand. No step here has been observed running.",
  },
  "derived-from-test": {
    label: "derived from test",
    className: "status-verified",
    icon: FlaskConical,
    title: "Reconstructed from a test run.",
  },
  "derived-from-otel": {
    label: "derived from otel",
    className: "border-accent text-accent",
    icon: Activity,
    title: "Reconstructed from production traces.",
  },
};

export function ProvenanceBadge({
  provenance,
  source,
  verifiedAt,
}: {
  provenance: Provenance;
  source?: string;
  verifiedAt?: string;
}) {
  const meta = PROVENANCE_META[provenance];
  const Icon = meta.icon;
  return (
    <span className={`chip-lg ${meta.className}`} title={meta.title}>
      <Icon size={14} aria-hidden />
      {meta.label}
      {provenance === "derived-from-otel" && verifiedAt ? (
        <span className="text-muted">· {absoluteTime(verifiedAt)}</span>
      ) : null}
      {provenance === "derived-from-test" && source ? (
        <span className="text-muted" title={source}>
          · {middleTruncate(source.split("/").pop() ?? source, 28)}
        </span>
      ) : null}
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
