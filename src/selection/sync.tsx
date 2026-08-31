// Keeps the selection, the URL and the route in step.
//
// Three rules, and no fourth: a selection in the URL wins on arrival; a
// selection in the store is written back to the URL with `replace`, so cycling
// through steps does not bury the back button; and a navigation that lands on a
// page which cannot show the selection drops it.

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { parseSelectionHash, selectionHash } from "./hash";
import { sameSelection } from "./model";
import { pageContains } from "./pages";
import { useSelection, useSelectionStore } from "./store";

const SEL = "#sel=";

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function SelectionSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const selection = useSelection();
  const last = useRef({ pathname: "", hash: "" });

  // --- URL -> store -------------------------------------------------------
  useEffect(() => {
    const previous = last.current;
    last.current = { pathname: location.pathname, hash: location.hash };
    const store = useSelectionStore.getState();

    const parsed = parseSelectionHash(location.hash);
    if (parsed) {
      if (!sameSelection(parsed, store.selection)) store.set(parsed, "url");
      return;
    }

    if (!store.selection) return;

    // A move to another page keeps the selection only if the new page can
    // point at it; the hash is re-stamped below when it can.
    if (previous.pathname !== location.pathname) {
      if (!pageContains(location.pathname, store.selection)) {
        store.clear("page");
      }
      return;
    }

    // Same page, and the selection left the URL — history moved, not us.
    if (previous.hash.startsWith(SEL) && !location.hash.startsWith(SEL)) {
      store.clear("url");
    }
  }, [location.pathname, location.hash]);

  // --- store -> URL -------------------------------------------------------
  useEffect(() => {
    // Read through to the store rather than using the value this render
    // captured. Both effects run after the same commit, in order, and the one
    // above has just written the selection it parsed out of the hash — a stale
    // `null` read here would strip that hash straight back off on first load.
    const current = useSelectionStore.getState().selection;
    const want = selectionHash(current);
    if (location.hash === want) return;
    // Anchors that are not ours — a readme outline link, say — are left alone
    // as long as nothing is selected.
    if (!current && !location.hash.startsWith(SEL)) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: want },
      { replace: true },
    );
  }, [selection, location.pathname, location.search, location.hash, navigate]);

  // --- Esc clears ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isFormField(e.target)) return;
      if (useSelectionStore.getState().selection) {
        useSelectionStore.getState().clear("panel");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
