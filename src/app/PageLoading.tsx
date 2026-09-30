import { DiagramSkeleton } from "../components/DiagramSkeleton";

// What the main pane holds while a page's chunk is on its way. Every page but
// the overview is fetched when it is first opened, so a click has to be
// answered by the pane it will land in: the header strip every page opens with
// (a kind label, then a name) and, below it, either a few lines of text or the
// diagram a map or a graph will draw. Neutral masses on the surface colour, as
// in DiagramSkeleton, so nothing in them reads as content. The whole pane
// fades in late (`.page-loading`), so a cached chunk never flashes it.

const LINES = ["72%", "58%", "66%", "40%"];

export function PageLoading({
  diagram = false,
  label = "loading the page",
}: {
  /** The page is one large drawing: hold its place with the diagram skeleton. */
  diagram?: boolean;
  label?: string;
}) {
  return (
    <div className="page-loading flex h-full flex-col overflow-hidden bg-canvas" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="shrink-0 border-b border-line px-gutter pt-5 pb-3.5">
        <span className="block h-2.5 w-24 rounded-control bg-raised" />
        <span className="mt-3 block h-4 w-56 max-w-full rounded-control bg-raised" />
      </div>
      {diagram ? (
        <div aria-hidden className="relative min-h-0 flex-1">
          <DiagramSkeleton />
        </div>
      ) : (
        <div aria-hidden className="flex flex-col gap-3 p-gutter">
          {LINES.map((width, i) => (
            <span key={i} className="block h-3 rounded-control bg-raised" style={{ width }} />
          ))}
        </div>
      )}
    </div>
  );
}
