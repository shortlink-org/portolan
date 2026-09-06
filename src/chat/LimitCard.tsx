// What the panel says when the model cannot answer right now.
//
// The two cases a free tier produces are told apart: a limit, which passes
// with a minute or with a key of the reader's own, and a busy model, which
// passes with a retry. Anything else is shown as it came.

import { useEffect, useState } from "react";
import { KeyRound, RotateCcw } from "lucide-react";

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

export function LimitCard({
  trouble,
  demo,
  onRetry,
  onOwnKey,
}: {
  trouble: Trouble;
  /** Answering through the proxy: the limit is the demo's, and a key of the reader's own is a way round it. */
  demo: boolean;
  onRetry: () => void;
  onOwnKey: () => void;
}) {
  const limit = trouble.kind === "limit";
  const [left, setLeft] = useState(limit ? RETRY_AFTER : 0);

  useEffect(() => {
    if (!limit) return;
    setLeft(RETRY_AFTER);
    const timer = setInterval(
      () => setLeft((n) => (n > 0 ? n - 1 : 0)),
      1000,
    );
    return () => clearInterval(timer);
  }, [limit, trouble]);

  if (trouble.kind === "other") {
    return (
      <div className="rounded-card border border-line bg-surface px-3 py-2">
        <div className="mono text-unresolved break-words">{trouble.text}</div>
        <button type="button" onClick={onRetry} className="mono mt-2 flex items-center gap-1.5 text-accent hover:underline">
          <RotateCcw size={13} aria-hidden /> try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface px-3 py-3">
      <div className="font-semibold text-ink">
        {limit ? "the free tier is out of breath" : "the model is busy"}
      </div>
      <p className="mt-1 text-muted">
        {limit
          ? demo
            ? "The demo answers ten questions a minute per reader, and Google gives it a daily quota shared by everyone. Both come back on their own."
            : "Your provider says the limit is reached. It comes back on its own."
          : "Google reports high demand on the model. That usually passes in a moment."}
      </p>
      <details className="mono mt-2 text-muted">
        <summary className="cursor-pointer select-none">what it said</summary>
        <div className="mt-1 break-words">{trouble.text}</div>
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={left > 0}
          className="mono flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-ink transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-60"
        >
          <RotateCcw size={13} aria-hidden />
          {left > 0 ? `try again in ${left}s` : "try again"}
        </button>
        {limit && demo ? (
          <button
            type="button"
            onClick={onOwnKey}
            className="mono flex items-center gap-1.5 rounded-control border border-accent px-2.5 py-1 text-accent transition-colors hover:bg-raised"
          >
            <KeyRound size={13} aria-hidden /> use your own key
          </button>
        ) : null}
      </div>
    </div>
  );
}
