// Where peeks come from: one listener, the whole document.
//
// Every row that can be selected already says which catalog id it stands for
// - `data-sel` on the tree, the canvases and the tables - and anything else
// that leads to an entity says so with `data-peek`. One handler on the
// document reads that attribute off whatever the pointer is over, which is
// how a card appears on a row written before this file existed.
//
// The rules of the card, in order of how often they matter:
//
//   - It waits 400ms. A pointer crossing a list on its way somewhere else
//     must not leave a trail of cards behind it.
//   - Anything the reader does dismisses it: a key, a click, a scroll. The
//     card is for the moment before deciding, and each of those is a decision.
//   - Moving from the row into the card keeps it, for 150ms of grace across
//     the gap. It holds no controls, but a reader who wants to read the whole
//     blurb should be able to put the pointer on it.
//   - There is no card for what the panel is already showing, and none on a
//     touch screen or a narrow window, where there is no hover to speak of.

import { useEffect, useRef, useState } from "react";
import { useNarrow } from "../app/responsive";
import { AnimatePresence } from "../lib/motion";
import { useSelectionStore } from "../selection/store";
import { PeekCard } from "./PeekCard";
import { peekOf } from "./model";
import type { Peek } from "./model";

export const PEEK_DELAY_MS = 400;
const GRACE_MS = 150;

/** What the pointer is over, or null when it is over nothing that peeks. */
export function anchorOf(
  target: EventTarget | null,
): { el: HTMLElement; id: string } | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[data-peek],[data-sel]");
  if (!el || el.closest("[data-peek-card]")) return null;
  const id = el.dataset.peek || el.dataset.sel;
  return id ? { el, id } : null;
}

interface Shown {
  peek: Peek;
  rect: DOMRect;
}

export function PeekLayer() {
  const narrow = useNarrow();
  const [shown, setShown] = useState<Shown | null>(null);
  // Read at hover time, not subscribed: the handler is installed once.
  const selectedId = useRef<string | null>(null);
  selectedId.current = useSelectionStore((s) => s.selection?.id ?? null);

  useEffect(() => {
    if (narrow) return;
    if (typeof window.matchMedia === "function" && !window.matchMedia("(hover: hover)").matches) return;

    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    // The element a pending or shown card belongs to; entering its children
    // again is not a new hover.
    let anchor: HTMLElement | null = null;

    const cancelShow = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
    };
    const cancelHide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
    };
    const hide = () => {
      cancelShow();
      cancelHide();
      anchor = null;
      setShown(null);
    };
    const hideSoon = () => {
      cancelShow();
      if (hideTimer) return;
      hideTimer = setTimeout(hide, GRACE_MS);
    };

    const arm = (el: HTMLElement, id: string) => {
      if (anchor === el) {
        cancelHide();
        return;
      }
      cancelShow();
      cancelHide();
      anchor = el;
      showTimer = setTimeout(() => {
        showTimer = null;
        if (id === selectedId.current) return;
        const peek = peekOf(id);
        if (!peek || !el.isConnected) return;
        setShown({ peek, rect: el.getBoundingClientRect() });
      }, PEEK_DELAY_MS);
    };

    const onOver = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-peek-card]")) {
        cancelHide();
        return;
      }
      const a = anchorOf(e.target);
      if (a) arm(a.el, a.id);
      else hideSoon();
    };
    const onFocusIn = (e: FocusEvent) => {
      const a = anchorOf(e.target);
      if (a) arm(a.el, a.id);
      else hide();
    };
    const onLeaveWindow = (e: MouseEvent) => {
      if (e.relatedTarget === null) hide();
    };
    // A scroll moves the anchor out from under the card; a pending card
    // reads its rect when it fires, so only what is on screen goes.
    const onScroll = () => setShown(null);

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onLeaveWindow);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      hide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onLeaveWindow);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [narrow]);

  return (
    <AnimatePresence>
      {shown ? (
        <PeekCard key={shown.peek.id} peek={shown.peek} rect={shown.rect} />
      ) : null}
    </AnimatePresence>
  );
}
