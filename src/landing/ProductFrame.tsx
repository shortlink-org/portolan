import type { ReactNode } from "react";
import { CompassRose } from "../components/logo";

export function ProductFrame({
  title,
  eyebrow,
  children,
  className = "",
  aside = true,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  className?: string;
  /** The sketched catalog tree down the left. Off for a canvas that wants the whole width. */
  aside?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[18px] border border-line bg-canvas shadow-md ${className}`}
    >
      <div className="flex h-11 items-center gap-3 border-b border-line bg-surface px-4">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2 rounded-full bg-unresolved/70" />
          <span className="size-2 rounded-full bg-declared/70" />
          <span className="size-2 rounded-full bg-verified/70" />
        </div>
        <div className="mono flex min-w-0 flex-1 items-center justify-center gap-1.5 text-faint">
          <CompassRose size={13} />
          <span className="truncate">{title}</span>
        </div>
        <span className="w-[35px]" aria-hidden />
      </div>
      <div
        className={`grid min-h-0 grid-cols-1 ${
          aside ? "sm:grid-cols-[132px_minmax(0,1fr)]" : ""
        }`}
      >
        {aside ? (
        <aside className="hidden border-r border-line bg-canvas p-3 sm:block">
          <div className="label mb-3">{eyebrow}</div>
          <div className="space-y-1.5" aria-hidden>
            <div className="h-2 w-20 rounded-full bg-line-strong" />
            <div className="h-2 w-16 rounded-full bg-line" />
            <div className="h-2 w-24 rounded-full bg-line" />
          </div>
          <div className="label mt-6 mb-3">catalog</div>
          <div className="space-y-2" aria-hidden>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-[1px] bg-[var(--ctx-0)]" />
              <div className="h-2 w-16 rounded-full bg-line" />
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-[1px] bg-[var(--ctx-1)]" />
              <div className="h-2 w-20 rounded-full bg-line" />
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-[1px] bg-[var(--ctx-2)]" />
              <div className="h-2 w-14 rounded-full bg-line" />
            </div>
          </div>
        </aside>
        ) : null}
        <div className="landing-grid min-w-0">{children}</div>
      </div>
    </div>
  );
}
