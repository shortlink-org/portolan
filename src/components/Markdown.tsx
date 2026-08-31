import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
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

/** Headings get ids so the outline rail can jump to them. */
function heading(level: 1 | 2 | 3) {
  return function Heading(props: ComponentPropsWithoutRef<"h1">) {
    const Tag = `h${level}` as const;
    return <Tag id={headingSlug(textOf(props.children))}>{props.children}</Tag>;
  };
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
          ...(mermaid ? { pre: Pre } : {}),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
