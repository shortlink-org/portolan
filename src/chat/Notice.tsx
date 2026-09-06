// What the panel says when it cannot answer.
//
// One box for every such moment - a limit reached, a busy model, a failed
// request, nothing configured - so they line up the same way and the reader
// learns one shape. The two the free tier produces most are told apart: a
// limit passes with a minute or a key of the reader's own; a busy model
// passes with a retry.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  CloudOff,
  Hourglass,
  Info,
  KeyRound,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Tone = "limit" | "busy" | "error" | "info";

const ICON: Record<Tone, LucideIcon> = {
  limit: Hourglass,
  busy: CloudOff,
  error: TriangleAlert,
  info: Info,
};

const TONE: Record<Tone, string> = {
  limit: "text-declared",
  busy: "text-declared",
  error: "text-unresolved",
  info: "text-accent",
};

export function Notice({
  tone,
  title,
  children,
  actions,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-3">
      <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2">
        <Icon size={16} aria-hidden className={`mt-0.5 ${TONE[tone]}`} />
        <div className="min-w-0">
          <div className="font-semibold text-ink">{title}</div>
          {children ? <div className="mt-1 text-muted">{children}</div> : null}
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

export const ACTION =
  "mono flex items-center gap-1.5 rounded-control border px-2.5 py-1 transition-colors disabled:cursor-default disabled:opacity-60";
export const ACTION_PLAIN = `${ACTION} border-line text-ink hover:border-line-strong`;
export const ACTION_ACCENT = `${ACTION} border-accent text-accent hover:bg-raised`;

export type Trouble =
  | { kind: "limit"; text: string }
  | { kind: "busy"; text: string }
  | { kind: "other"; text: string };

/** The status, when the error carries one, and the text either way. */
export function classify(error: unknown): Trouble {
  const text =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : NaN;
  if (
    status === 429 ||
    /\b429\b|quota|rate.?limit|resource_exhausted|too many requests/i.test(text)
  ) {
    return { kind: "limit", text };
  }
  if (
    status === 503 ||
    /\b503\b|unavailable|high demand|overloaded/i.test(text)
  ) {
    return { kind: "busy", text };
  }
  return { kind: "other", text };
}

const RETRY_AFTER = 60;

/** The SDK's word for a request that never got a response. */
const GENERIC = /^an error occurred\.?$|failed to fetch|networkerror|load failed/i;

export function TroubleNotice({
  trouble,
  demo,
  where,
  onRetry,
  onOwnKey,
}: {
  trouble: Trouble;
  /** Answering through the proxy: the limit is the demo's, and a key of the reader's own is a way round it. */
  demo: boolean;
  /** Who was asked, for the message that says nobody answered. */
  where: string;
  onRetry: () => void;
  onOwnKey: () => void;
}) {
  const limit = trouble.kind === "limit";
  const [left, setLeft] = useState(limit ? RETRY_AFTER : 0);

  useEffect(() => {
    if (!limit) return;
    setLeft(RETRY_AFTER);
    const timer = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [limit, trouble]);

  const said = (
    <details className="mono mt-2">
      <summary className="cursor-pointer select-none">what it said</summary>
      <div className="mt-1 break-words">{trouble.text}</div>
    </details>
  );

  const retry = (
    <button
      type="button"
      onClick={onRetry}
      disabled={left > 0}
      className={ACTION_PLAIN}
    >
      <RotateCcw size={13} aria-hidden />
      {left > 0 ? `try again in ${left}s` : "try again"}
    </button>
  );

  if (trouble.kind === "other") {
    const unreachable = GENERIC.test(trouble.text.trim());
    return (
      <Notice
        tone="error"
        title={unreachable ? "nobody answered" : "the question did not go through"}
        actions={retry}
      >
        {unreachable ? (
          <>
            Nothing came back from <span className="mono">{where}</span>. Check
            the endpoint, or that the network lets the browser reach it.
          </>
        ) : (
          <span className="mono break-words">{trouble.text}</span>
        )}
      </Notice>
    );
  }

  if (trouble.kind === "busy") {
    return (
      <Notice tone="busy" title="the model is busy" actions={retry}>
        Google reports high demand on the model. That usually passes in a moment.
        {said}
      </Notice>
    );
  }

  return (
    <Notice
      tone="limit"
      title="the free tier is out of breath"
      actions={
        <>
          {retry}
          {demo ? (
            <button type="button" onClick={onOwnKey} className={ACTION_ACCENT}>
              <KeyRound size={13} aria-hidden /> use your own key
            </button>
          ) : null}
        </>
      }
    >
      {demo
        ? "The demo answers ten questions a minute per reader, and Google gives it a daily quota shared by everyone. Both come back on their own."
        : "Your provider says the limit is reached. It comes back on its own."}
      {said}
    </Notice>
  );
}
