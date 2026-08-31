import { useEffect, useRef, useState } from "react";
import { useTheme } from "../app/theme";

/**
 * Renders one mermaid fence. The library is ~500kB and is wanted on ADR pages
 * only, so it is imported on first render and never from the app entry.
 *
 * A diagram inside a decision record is a quotation from a frozen document,
 * not a picture of the model as it stands. It is drawn exactly as written,
 * even when the current catalog disagrees with it.
 */

let seq = 0;

type Phase = "loading" | "drawn" | { error: string };

export function Mermaid({ code }: { code: string }) {
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "neutral",
          fontFamily: "var(--font-mono)",
          sequence: { useMaxWidth: true },
          flowchart: { useMaxWidth: true },
        });
        seq += 1;
        const { svg } = await mermaid.render(`mermaid-${seq}`, code);
        if (cancelled) return;
        if (host.current) host.current.innerHTML = svg;
        setPhase("drawn");
      } catch (err) {
        if (cancelled) return;
        setPhase({ error: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  // A diagram that will not parse is still evidence: show the source it was
  // written as, rather than an empty box.
  if (typeof phase === "object") {
    return (
      <figure className="my-3">
        <div className="mono border border-dashed px-2 py-1 status-unresolved">
          this diagram does not parse — {phase.error}
        </div>
        <pre className="mt-1">{code}</pre>
      </figure>
    );
  }

  return (
    <figure className="my-3 border border-line bg-surface p-3">
      <div ref={host} className="mermaid-figure overflow-x-auto" />
      {phase === "loading" ? (
        <div className="mono text-muted">drawing…</div>
      ) : null}
    </figure>
  );
}
