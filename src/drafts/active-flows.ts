// The branch version a flow page is showing, for the selection to resolve its
// steps against (portolan.0019). Kept apart from the drafts store: the
// selection model is imported by the routes, and the drafts store imports the
// routes to link its entities.

import { create } from "zustand";
import type { Flow } from "../catalog";

interface ActiveFlows {
  /** The flow on screen, by slug, when it is a branch's version. */
  flows: Record<string, Flow>;
  /** The page a branch-only flow is shown on, by slug; main's flows have their own. */
  pages: Record<string, string>;
  set: (slug: string, flow: Flow | null, page?: string) => void;
}

export const useActiveFlows = create<ActiveFlows>()((set, get) => ({
  flows: {},
  pages: {},
  set: (slug, flow, page) => {
    const flows = { ...get().flows };
    const pages = { ...get().pages };
    if (flow) flows[slug] = flow;
    else delete flows[slug];
    if (flow && page) pages[slug] = page;
    else delete pages[slug];
    set({ flows, pages });
  },
}));
