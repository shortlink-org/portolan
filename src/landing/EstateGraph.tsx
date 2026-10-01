// The tour's first stop: the dependency graph, the real one. Its toolbar,
// its two modes, its focus and export, on the example estate. Nothing here
// is a mock-up of the product; it is the product, in a smaller box.

import { useMemo, useState } from "react";
import { usePhone } from "../app/responsive";
import { catalog } from "../data";
import { DependencyGraphPane } from "../graph/DependencyGraph";
import type { GraphMode } from "../graph/dependency-layout";
import { eventGraph } from "../lib/event-graph";
import { useSelectionCleared } from "./catalog";

export function EstateGraph() {
  const graph = useMemo(() => eventGraph(catalog), []);
  const [mode, setMode] = useState<GraphMode>("compact");
  // A phone's box is taller than it is wide, so the layers run down it and
  // the box grows to hold them: fitted to a width of 350px, a graph nine
  // layers across is a row of unreadable chips.
  const phone = usePhone();
  const direction = phone ? "DOWN" : "RIGHT";
  useSelectionCleared();

  return (
    <div className="h-[560px] sm:h-[470px]">
      <DependencyGraphPane
        graph={graph}
        mode={mode}
        onMode={setMode}
        fitKey={`${mode}:${direction}`}
        zoomOnScroll={false}
        direction={direction}
      />
    </div>
  );
}
