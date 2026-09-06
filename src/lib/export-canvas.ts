// A React Flow viewport, saved as a picture.
//
// The viewport is captured at its own size rather than the box's, so the file
// holds the whole drawing however far it has been panned. Every canvas in the
// app - the flow, the ER schema, the dependency graph, the context map - goes
// out through here, so a picture of one looks like a picture of another.

import { toPng, toSvg } from "html-to-image";
import { artifactFilename } from "./export-file";

export type ImageKind = "png" | "svg";

/** The element html-to-image should capture: the pannable layer of a canvas. */
export function viewportOf(root: Element | null | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>(".react-flow__viewport") ?? null;
}

/**
 * Render the viewport and hand it to the browser as a download. Resolves to
 * the file name it went out under, so the caller can say so.
 */
export async function saveCanvasImage(
  viewport: HTMLElement,
  name: string,
  kind: ImageKind,
): Promise<string> {
  const render = kind === "png" ? toPng : toSvg;
  const url = await render(viewport, {
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    ...(kind === "png" ? { pixelRatio: 2 } : {}),
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = artifactFilename(name, kind);
  a.click();
  return a.download;
}
