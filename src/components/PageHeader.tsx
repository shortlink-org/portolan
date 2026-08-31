import type { ReactNode } from "react";
import { ctxStyle } from "../lib/context-color";

/**
 * The header strip every entity page opens with. `contextId` paints the hero
 * wash - 120px of that context's colour at 6%, fading to nothing. The header's
 * own content sits above it on solid background, so no text is ever read off
 * a gradient.
 */
export function PageHeader({
  kind,
  name,
  id,
  contextId,
  right,
  children,
}: {
  kind: string;
  name: string;
  id?: string;
  contextId?: string | null;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="hero border-b border-line px-gutter py-5">
      <div aria-hidden className="hero-wash" style={ctxStyle(contextId)} />
      <div className="label">{kind}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-md font-semibold" title={name}>
          {name}
        </h1>
        {id ? (
          <span className="mono text-muted" title={id}>
            {id}
          </span>
        ) : null}
        {right ? (
          <div className="ml-auto flex items-center gap-2">{right}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="label">{children}</h2>
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
