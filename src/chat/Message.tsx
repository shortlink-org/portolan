// One turn of the conversation, on a grid.
//
// A gutter for who is speaking, a column for what was said. The reader's
// turn sits on a raised block; the answer sits on the page itself, because
// it is the page's own words arranged, and a block around every paragraph
// and card would be a box in a box.

import type { ReactNode } from "react";
import { User } from "lucide-react";
import { Boat } from "./Waiting";

export function Message({
  role,
  glyph,
  children,
  foot,
}: {
  role: "user" | "assistant";
  /** Replaces the role's own mark; the waiting row puts the moving boat here. */
  glyph?: ReactNode;
  children: ReactNode;
  /** A last line under the turn: how long it took. */
  foot?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <div className="flex h-7 items-center justify-center">
        {glyph ??
          (role === "user" ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-raised text-muted">
              <User size={13} aria-hidden />
            </span>
          ) : (
            <Boat size={24} className="text-accent" />
          ))}
      </div>
      <div className="min-w-0 pt-0.5">
        {role === "user" ? (
          <div className="whitespace-pre-wrap rounded-card bg-surface px-3 py-2 text-ink">
            {children}
          </div>
        ) : (
          <div className="space-y-3">{children}</div>
        )}
        {foot ? <div className="mono mt-1.5 text-muted">{foot}</div> : null}
      </div>
    </div>
  );
}
