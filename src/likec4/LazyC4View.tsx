import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { C4View as LoadedC4View } from "./C4View";
import { DiagramSkeleton } from "../components/DiagramSkeleton";

// LikeC4's renderer and the generated model are ~2.8 MB, more than the rest of
// the catalog put together. The pages that draw a C4 view have text of their
// own to show first, so the diagram is fetched on its own and a skeleton of
// the same box holds its place: nothing below it moves when it lands.

const Loaded = lazy(() => import("./C4View").then((module) => ({ default: module.C4View })));

/** Starts fetching the diagram code without drawing anything. */
export function preloadC4View(): void {
  void import("./C4View");
}

export function C4View(props: ComponentProps<typeof LoadedC4View>) {
  return (
    <Suspense
      fallback={
        <div
          className="relative w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs"
          style={{ height: props.height ?? 320 }}
        >
          <DiagramSkeleton />
        </div>
      }
    >
      <Loaded {...props} />
    </Suspense>
  );
}
