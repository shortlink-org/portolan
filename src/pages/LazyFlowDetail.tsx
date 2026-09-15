import { lazy } from "react";
import type { ComponentProps } from "react";
import type { FlowDetail as LoadedFlowDetail } from "./FlowDetail";
import { SuspenseReveal } from "../components/SuspenseReveal";

// A flow page is LikeC4 and elk end to end, several megabytes the pages
// without a flow never use. Every place that shows one goes through here, so
// no static import pulls it back into the chunk the catalog starts from.

const Loaded = lazy(() => import("./FlowDetail").then((module) => ({ default: module.FlowDetail })));

/** Starts fetching the flow page without drawing anything. */
export function preloadFlowDetail(): void {
  void import("./FlowDetail");
}

export function FlowDetail(props: ComponentProps<typeof LoadedFlowDetail>) {
  return (
    <SuspenseReveal fallback={<div className="h-full p-gutter text-muted">Loading the flow…</div>}>
      <Loaded {...props} />
    </SuspenseReveal>
  );
}
