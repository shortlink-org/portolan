import { useCallback } from "react";
import { InteractiveView } from "./InteractiveView";
import { catalogIdOf } from "./mapping";
import { fqn } from "./ids";
import { viewHasNode } from "./view-index";
import { useSelectionStore } from "../selection/store";

/**
 * A declared C4 element view. Same renderer as the flows, same generated
 * sources — portolan never draws these itself. Clicking a node selects what it
 * stands for; clicking the canvas clears.
 */
export function C4View({
  viewId,
  height = 320,
  controls = false,
}: {
  viewId: string;
  height?: number | string;
  /** Zoom controls, useful when a whole estate has to fit on a phone. */
  controls?: boolean;
}) {
  const selection = useSelectionStore((s) => s.selection);
  const source = useSelectionStore((s) => s.source);
  const select = useSelectionStore((s) => s.select);
  const clear = useSelectionStore((s) => s.clear);

  const onNode = useCallback(
    (likec4Id: string) => select(catalogIdOf(likec4Id), "diagram"),
    [select],
  );
  const onCanvas = useCallback(() => clear("diagram"), [clear]);

  // A selection made here is already marked by LikeC4 itself; one made
  // elsewhere is only marked when this view actually draws it.
  const marked =
    selection && source !== "diagram" && viewHasNode(viewId, fqn(selection.id))
      ? [fqn(selection.id)]
      : [];

  return (
    <div
      className="w-full overflow-hidden rounded-card border border-line bg-canvas shadow-xs"
      style={{ height }}
    >
      <InteractiveView
        viewId={viewId}
        controls={controls}
        highlightNodes={marked}
        onNode={onNode}
        onCanvas={onCanvas}
      />
    </div>
  );
}
