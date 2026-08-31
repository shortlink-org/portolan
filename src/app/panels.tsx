// Resizable layout, in one place.
//
// react-resizable-panels v4 calls them Group / Panel / Separator. Everything
// portolan needs on top of that is here: a persisted layout keyed by page, a
// separator that reads as a hairline until you reach for it, and a hook that
// tells a canvas its box changed.

import { useCallback, useEffect, useRef } from "react";
import { Group, Separator, useDefaultLayout } from "react-resizable-panels";
import type { GroupProps } from "react-resizable-panels";

export { Panel, usePanelRef } from "react-resizable-panels";
export type { PanelImperativeHandle } from "react-resizable-panels";

/** The 100ms every canvas in the app waits before it re-measures. */
export const RESIZE_SETTLE_MS = 100;

/**
 * localStorage, but a private-mode failure is not worth a crash: a layout that
 * cannot be remembered is a layout that starts at its defaults.
 */
const storage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: this session still resizes, it just does not persist */
    }
  },
};

/**
 * A Group whose layout survives a reload. `id` is the storage key and is
 * spelled "portolan:<page>" at every call site, so one glance at localStorage
 * says which page a layout belongs to.
 *
 * `panelIds` matters when a Group holds a Panel that is not always rendered -
 * without it the restored layout is applied to the wrong panels.
 */
export function SavedGroup({
  id,
  panelIds,
  children,
  ...rest
}: Omit<GroupProps, "id" | "defaultLayout" | "onLayoutChanged"> & {
  id: string;
  panelIds?: string[];
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    storage,
    ...(panelIds ? { panelIds } : {}),
  });
  return (
    <Group
      id={id}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      {...rest}
    >
      {children}
    </Group>
  );
}

/**
 * The divider. A 1px hairline that thickens to a 3px accent rule under the
 * pointer or the keyboard, drawn by a child rather than by the separator's own
 * border, so the 8px hit area never becomes 8px of visible gutter and nothing
 * around it reflows when the rule thickens.
 *
 * Double-click resets the neighbouring panel to its default size; that is the
 * library's own behaviour and is left on deliberately.
 */
export function ResizeHandle({
  orientation = "horizontal",
  id,
}: {
  /** Matches the parent Group. Horizontal groups get a vertical divider. */
  orientation?: "horizontal" | "vertical";
  id?: string;
}) {
  const vertical = orientation === "horizontal";
  return (
    <Separator
      {...(id ? { id } : {})}
      className={`group relative z-20 flex shrink-0 items-center justify-center ${
        vertical ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
      }`}
      title="Drag to resize · double-click to reset"
    >
      {/* The library puts data-separator="inactive|hover|focus|active" on the
          separator itself, and its "hover" accounts for the full 8px target -
          wider than the 1px rule the reader can actually see. Keying off that
          rather than :hover is what makes the rule thicken as soon as the
          pointer is in the hit area, and it covers the keyboard the same way. */}
      <span
        aria-hidden
        className={`bg-line t-micro transition-[background-color,width,height] group-data-[separator=hover]:bg-accent group-data-[separator=focus]:bg-accent group-data-[separator=active]:bg-accent ${
          vertical
            ? "h-full w-px group-data-[separator=hover]:w-[3px] group-data-[separator=focus]:w-[3px] group-data-[separator=active]:w-[3px]"
            : "h-px w-full group-data-[separator=hover]:h-[3px] group-data-[separator=focus]:h-[3px] group-data-[separator=active]:h-[3px]"
        }`}
      />
    </Separator>
  );
}

/**
 * Tells a canvas its box changed, once the dragging has stopped.
 *
 * LikeC4 and React Flow both re-measure on the window's resize event, and both
 * are expensive enough that doing it on every frame of a drag is visible. The
 * trailing 100ms edge is the whole point: the reader drags, the picture
 * re-lays-out once, when they let go.
 */
export function useCanvasResize(): () => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      window.dispatchEvent(new Event("resize"));
    }, RESIZE_SETTLE_MS);
  }, []);
}
