// The keyboard.
//
// One handler, one table. The table below is what the "?" sheet prints and what
// the handler implements, so the sheet cannot drift from the app: adding a
// shortcut without listing it is not possible without editing both halves of
// the same object.
//
// Two rules hold everywhere. Nothing fires while a text field has focus - a
// reader typing "flows" into the filter must not be teleported four times - and
// ⌘K keeps working regardless, because opening the palette is the one thing a
// reader does *from* a field.

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { Modal } from "../components/Overlay";
import { OVERVIEW_ANCHOR, paths } from "../routes";

export interface Shortcut {
  /** Rendered as separate keycaps; a chord is two entries. */
  keys: string[];
  what: string;
}

/**
 * The "g" chord, once. The handler navigates from this table and the sheet
 * prints it, so a destination cannot exist in one and not the other.
 */
export const GO_TO: { key: string; to: string; what: string }[] = [
  { key: "f", to: paths.flows(), what: "flows" },
  {
    key: "d",
    to: `${paths.overview()}#${OVERVIEW_ANCHOR.contexts}`,
    what: "domains — the contexts, on the overview",
  },
  { key: "m", to: paths.map(), what: "the context map" },
  { key: "p", to: paths.problems(), what: "problems" },
  { key: "o", to: paths.overview(), what: "overview" },
];

export const SHORTCUT_GROUPS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Go to",
    items: GO_TO.map((g) => ({ keys: ["g", g.key], what: g.what })),
  },
  {
    group: "Layout",
    items: [
      { keys: ["["], what: "show or hide the catalog tree" },
      { keys: ["]"], what: "show or hide the detail panel" },
    ],
  },
  {
    group: "Lists and tables",
    items: [
      { keys: ["j"], what: "next row" },
      { keys: ["k"], what: "previous row" },
      { keys: ["⏎"], what: "open the row" },
    ],
  },
  {
    group: "Everywhere",
    items: [
      { keys: ["⌘", "K"], what: "search the whole catalog" },
      { keys: ["?"], what: "this sheet" },
      { keys: ["Esc"], what: "clear the selection, or close what is open" },
    ],
  },
];

/** True while the keystroke belongs to something the reader is typing into. */
function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * j / k walk whatever list the reader is standing in, and the first one on the
 * page when they are standing in none. Movement is DOM focus rather than a
 * highlight of our own, so Enter is the browser's Enter and the focus ring is
 * the one every other control uses.
 */
function moveListFocus(delta: number): boolean {
  const active = document.activeElement as HTMLElement | null;
  // Standing in a list walks that list. Standing nowhere walks the page's own
  // list before the catalog tree's - the tree is always on screen, and always
  // first in the DOM, so preferring it would mean j never touched the thing
  // the reader is actually looking at.
  const list =
    active?.closest<HTMLElement>("[data-nav-list]") ??
    document.querySelector<HTMLElement>("main [data-nav-list]") ??
    document.querySelector<HTMLElement>("[data-nav-list]");
  if (!list) return false;
  const items = [...list.querySelectorAll<HTMLElement>("[data-nav-item]")];
  if (items.length === 0) return false;
  const at = active ? items.indexOf(active) : -1;
  const next =
    at < 0
      ? delta > 0
        ? 0
        : items.length - 1
      : Math.min(items.length - 1, Math.max(0, at + delta));
  items[next]?.focus();
  items[next]?.scrollIntoView({ block: "nearest" });
  return true;
}

export interface ShortcutActions {
  openPalette: () => void;
  openHelp: () => void;
  toggleSidebar: () => void;
  toggleDetail: () => void;
}

/** How long a "g" waits for its second key before it goes back to being a "g". */
const CHORD_MS = 1200;

export function useShortcuts(actions: ShortcutActions, enabled: boolean): void {
  const navigate = useNavigate();
  // Refs so the listener is installed once: rebinding it on every render would
  // drop a chord half-typed.
  const act = useRef(actions);
  act.current = actions;
  const on = useRef(enabled);
  on.current = enabled;

  useEffect(() => {
    let chord = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const endChord = () => {
      chord = false;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onKey = (e: KeyboardEvent) => {
      // ⌘K first, and from anywhere at all - including a field.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        act.current.openPalette();
        return;
      }
      if (!on.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField(e.target)) return;
      if (e.defaultPrevented) return;

      const key = e.key;

      if (chord) {
        endChord();
        const target = GO_TO.find((g) => g.key === key);
        if (target) {
          e.preventDefault();
          navigate(target.to);
        }
        return;
      }

      if (key === "g") {
        chord = true;
        timer = setTimeout(endChord, CHORD_MS);
        return;
      }

      // "?" is Shift+/ on most layouts and a key of its own on some.
      if (key === "?") {
        e.preventDefault();
        act.current.openHelp();
        return;
      }
      if (key === "[") {
        e.preventDefault();
        act.current.toggleSidebar();
        return;
      }
      if (key === "]") {
        e.preventDefault();
        act.current.toggleDetail();
        return;
      }
      if (key === "j" || key === "k") {
        if (moveListFocus(key === "j" ? 1 : -1)) e.preventDefault();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [navigate]);
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono inline-flex min-w-5 items-center justify-center rounded-[4px] border px-1 py-px border-line-strong text-ink">
      {children}
    </kbd>
  );
}

export function ShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Keyboard shortcuts"
      width="min(560px,92vw)"
    >
      <>
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 border-line">
          <span className="label">keyboard</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close (Esc)"
            title="Esc"
            className="ml-auto rounded-control p-1 text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.group} className="mb-4 last:mb-0">
              <div className="label mb-1.5">{group.group}</div>
              <ul>
                {group.items.map((item) => (
                  <li
                    key={item.keys.join("+")}
                    className="flex items-baseline gap-3 py-1"
                  >
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Cap key={`${k}-${i}`}>{k}</Cap>
                      ))}
                    </span>
                    <span className="text-muted">{item.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="meta border-t pt-3 border-line">
            none of these fire while a text field has focus — ⌘K is the one
            exception, because that is what a field is for
          </p>
        </div>
      </>
    </Modal>
  );
}
