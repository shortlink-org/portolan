import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ADMONITION_LABEL, parseAdmonition } from "../lib/admonition";
import { AnchorLink } from "./AnchorLink";
import type { AdmonitionKind } from "../lib/admonition";
import { headingSlug } from "../lib/derive";
import { Mermaid } from "./Mermaid";

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return textOf(props?.children);
  }
  return "";
}

/**
 * Headings get ids so the outline rail can jump to them - and, having an id,
 * they get the link back out. A readme heading is where an invariant is
 * written down, so "send me the rule about cancelling" is a link, not a
 * screenshot.
 */
function heading(level: 1 | 2 | 3) {
  return function Heading(props: ComponentPropsWithoutRef<"h1">) {
    const Tag = `h${level}` as const;
    const text = textOf(props.children);
    const id = headingSlug(text);
    // A heading whose text slugs to nothing has no anchor to offer.
    if (!id) return <Tag>{props.children}</Tag>;
    return (
      <Tag id={id} className="anchored">
        {props.children}
        <AnchorLink id={id} label={text} />
      </Tag>
    );
  };
}

/** The visual half of src/lib/admonition.ts, in the manner of kind.tsx. */
const ADMONITION_ICON: Record<AdmonitionKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

/**
 * Four of the five borrow the meaning they already have in the app: an alert
 * that says "careful" is painted like a check that failed. Only `important`
 * needs a colour of its own.
 */
const ADMONITION_COLOR: Record<AdmonitionKind, string> = {
  note: "var(--accent)",
  tip: "var(--status-verified)",
  important: "var(--alert-important)",
  warning: "var(--status-declared)",
  caution: "var(--status-unresolved)",
};

/**
 * Splits a blockquote into `[!KIND]` and the prose under it. The marker is not
 * a node of its own - remark leaves it as the first characters of the first
 * paragraph - so the paragraph is rebuilt without it, and dropped entirely
 * when the marker was all it held.
 */
function asAdmonition(
  children: ReactNode,
): { kind: AdmonitionKind; body: ReactNode[] } | null {
  const blocks = Children.toArray(children).filter(
    (block) => typeof block !== "string" || block.trim() !== "",
  );
  const [first, ...rest] = blocks;
  if (!isValidElement<{ children?: ReactNode }>(first)) return null;
  if (first.type !== "p") return null;

  const inline = Children.toArray(first.props.children);
  if (typeof inline[0] !== "string") return null;
  const marker = parseAdmonition(inline[0]);
  if (!marker) return null;

  const lead = marker.rest
    ? [marker.rest, ...inline.slice(1)]
    : inline.slice(1);
  return {
    kind: marker.kind,
    body: [...(lead.length ? [<p key="lead">{lead}</p>] : []), ...rest],
  };
}

function Blockquote(props: ComponentPropsWithoutRef<"blockquote">) {
  const alert = asAdmonition(props.children);
  if (!alert) return <blockquote>{props.children}</blockquote>;

  const Icon = ADMONITION_ICON[alert.kind];
  return (
    <div
      className="callout"
      style={{ "--callout": ADMONITION_COLOR[alert.kind] } as CSSProperties}
    >
      <p className="callout-title">
        <Icon aria-hidden size={14} />
        {ADMONITION_LABEL[alert.kind]}
      </p>
      {alert.body}
    </div>
  );
}

/** The fence language of a <pre>'s single <code> child, if it has one. */
function fenceLanguage(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null;
  const match = /language-([\w-]+)/.exec(children.props.className ?? "");
  return match?.[1] ?? null;
}

function Pre(props: ComponentPropsWithoutRef<"pre">) {
  if (fenceLanguage(props.children) === "mermaid") {
    return <Mermaid code={textOf(props.children).replace(/\n$/, "")} />;
  }
  return <pre>{props.children}</pre>;
}

/**
 * Mermaid fences deliberately render as <pre> everywhere except decision
 * records. Portolan draws its own diagrams from measurements; a diagram
 * written by hand in a README is a quotation, not a fact, so it is shown as
 * the source text it is. An ADR is the one place where the quotation is the
 * whole point — pass `mermaid` there, and only there.
 */
export function Markdown({
  children,
  mermaid = false,
}: {
  children: string;
  mermaid?: boolean;
}) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          blockquote: Blockquote,
          ...(mermaid ? { pre: Pre } : {}),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
