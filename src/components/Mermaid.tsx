import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTheme } from "../app/theme";
import { toClipboard } from "../lib/clipboard";

/**
 * Renders one mermaid fence. The library is ~500kB and is wanted on the pages
 * that carry somebody's writing - a decision record, a service or aggregate
 * readme - so it is imported on first render and never from the app entry.
 *
 * A diagram in a readme is a quotation, not a measurement. It is drawn exactly
 * as written, even when the current catalog disagrees with it - but it is
 * drawn in this app's colours, because a picture in the estate's own palette
 * reads as part of the page and a picture in mermaid's reads as a screenshot
 * somebody pasted.
 */

let seq = 0;

type Phase = "loading" | "drawn" | { error: string };

const SHOWN_MS = 1000;

/** One custom property's value, resolved. Mermaid wants colours, not `var()`. */
function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * The theme mermaid is given, in this app's tokens.
 *
 * `base` is the only theme whose variables are honoured in full; every other
 * one computes its own and ignores most of what is passed. The mapping follows
 * LifecycleDiagram, which draws the catalog's own state machines: a node is
 * the page's background inside a `--border-strong` box, and an edge is
 * `--fg-muted` - so a quoted diagram and a measured one sit in the same family.
 *
 * Read after the palette is on the document, never before: the theme class is
 * set by ThemeProvider's effect, and a child's effect runs first.
 */
function themeVariables(dark: boolean) {
  const bg = token("--bg");
  const surface = token("--surface");
  const surface2 = token("--surface-2");
  const border = token("--border");
  const borderStrong = token("--border-strong");
  const fg = token("--fg");
  const muted = token("--fg-muted");

  return {
    darkMode: dark,
    background: surface,
    fontFamily: token("--font-mono"),
    fontSize: token("--text-sm"),

    primaryColor: bg,
    primaryBorderColor: borderStrong,
    primaryTextColor: fg,
    secondaryColor: surface2,
    tertiaryColor: surface,
    lineColor: muted,
    textColor: fg,
    mainBkg: bg,
    nodeBorder: borderStrong,
    nodeTextColor: fg,
    titleColor: fg,

    // The chip a label sits on. Painted as the sheet it lies on, so what the
    // reader sees is the word and not the box around it.
    edgeLabelBackground: surface,
    labelBackground: surface,
    labelBackgroundColor: surface,
    labelColor: fg,

    // State diagrams.
    stateBkg: bg,
    stateBorder: borderStrong,
    transitionColor: muted,
    transitionLabelColor: fg,
    specialStateColor: fg,
    innerEndBackground: bg,
    compositeBackground: surface,
    compositeTitleBackground: surface2,
    compositeBorder: border,
    altBackground: surface2,

    // Sequence diagrams.
    actorBkg: bg,
    actorBorder: borderStrong,
    actorTextColor: fg,
    actorLineColor: border,
    signalColor: muted,
    signalTextColor: fg,
    noteBkgColor: surface2,
    noteBorderColor: border,
    noteTextColor: fg,
    activationBkgColor: surface2,
    activationBorderColor: border,
    sequenceNumberColor: bg,
    loopTextColor: fg,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: fg,

    // Flowcharts.
    clusterBkg: surface,
    clusterBorder: border,
    defaultLinkColor: muted,
  };
}

export function Mermaid({ code }: { code: string }) {
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: themeVariables(theme === "dark"),
          fontFamily: "var(--font-mono)",
          // A diagram wider than the prose column belongs scaled down, not
          // behind a scrollbar. Every kind that can outgrow the column says so
          // for itself; the ones that cannot have nothing to say.
          sequence: { useMaxWidth: true },
          flowchart: { useMaxWidth: true },
          state: { useMaxWidth: true },
          class: { useMaxWidth: true },
          er: { useMaxWidth: true },
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

  // The way out of the page with the diagram in hand, on the same terms as a
  // flow's toolbar: the source, for a wiki or a pull request. Selecting text
  // inside an SVG gets you nothing.
  const copy = useCallback(() => {
    void toClipboard(code).then((ok) => {
      setCopied(ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
    });
  }, [code]);

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
    <figure className="group relative my-3 border border-line bg-surface p-3">
      <button
        type="button"
        onClick={copy}
        title={copied ? "copied" : "Copy the diagram as Mermaid"}
        aria-label="Copy the diagram as Mermaid"
        className="absolute right-1.5 top-1.5 inline-flex items-center rounded-[4px] p-1 text-muted opacity-0 t-micro transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? (
          <Check size={12} aria-hidden />
        ) : (
          <Copy size={12} aria-hidden />
        )}
      </button>
      <div ref={host} className="mermaid-figure overflow-x-auto" />
      {phase === "loading" ? (
        <div className="mono text-muted">drawing…</div>
      ) : null}
    </figure>
  );
}
