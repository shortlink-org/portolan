// What a drawing is, for when the page that says so is out of sight.
//
// On a page, the header and the section title name the picture and the level
// switch says its scope; saying it again over the canvas would be the page
// repeating itself. Given the whole screen, the drawing loses all three, so
// this plate carries them there and only there (`fullscreen-only`).

import { likec4model } from "./bundle";
import { C4_LEVEL, viewLevel } from "./levels";

export function ViewTitle({ viewId }: { viewId: string }) {
  const view = likec4model.findView(viewId);
  if (!view) return null;
  const level = viewLevel(viewId);
  const said = view.$view.description;
  const description = (typeof said === "string" ? said : said?.txt) || (level === "deployment" ? "where each service runs: environment, cluster and namespace" : C4_LEVEL[level].note);
  return (
    <div className="fullscreen-only pointer-events-none absolute top-3 left-1/2 z-10 max-w-[min(40rem,calc(100%-20rem))] -translate-x-1/2 flex-col items-center rounded-card border border-line bg-canvas px-card py-2 text-center shadow-xs">
      <div className="flex flex-wrap items-baseline justify-center gap-x-2">
        <span className="text-md font-semibold text-ink">{view.title}</span>
        <span className="mono text-sm text-muted">{level === "deployment" ? "deployment" : `C4 L${level} · ${C4_LEVEL[level].name}`}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">{description}</p>
    </div>
  );
}
