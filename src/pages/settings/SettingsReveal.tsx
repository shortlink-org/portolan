import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { m, transitions, useReducedMotion } from "../../lib/motion";

/** Keep drafts mounted, but remove collapsed controls from focus and accessibility. */
export function SettingsReveal({ open, id, label, children }: { open: boolean; id?: string; label: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <m.div id={id} role="region" aria-label={label} aria-hidden={!open} inert={!open}
    initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
    transition={reduced ? { duration: 0 } : transitions.panel} style={{ overflow: "hidden" }}>
    {children}
  </m.div>;
}

export function SettingsChevron({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  return <m.span aria-hidden className="inline-flex shrink-0" initial={false} animate={{ rotate: open ? 180 : 0 }} transition={reduced ? { duration: 0 } : transitions.micro}><ChevronDown size={14} /></m.span>;
}
