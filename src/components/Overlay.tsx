// The two shapes anything in this app can take when it covers the page.
//
// There were four hand-rolled overlays before this file: the palette, the
// shortcuts sheet, the catalog drawer and the detail sheet. All four wrote the
// same fixed box, the same 45% scrim, the same "mousedown on the scrim closes
// me", and each one had a different half of a modal's real job. None trapped
// focus, so Tab walked out of the palette into the page behind it; none gave
// focus back to whatever opened them; two listened for Escape on `window` with
// capture and two did not.
//
// So the behaviour is Headless UI's Dialog - focus trap, focus restore, scroll
// lock, `aria-modal`, outside click, Escape - and what is left here is the two
// paints this app actually has: a MODAL, which arrives in the middle and is
// about a task, and a SIDE PANEL, which arrives from an edge and is a pane that
// ran out of room to be one.
//
// Both leave the way they came. Headless UI unmounts a closed Dialog on the
// spot, so the exit is Motion's: `static` hands the mounting to us, an
// <AnimatePresence> keeps the node alive for the exit, and the backdrop and
// panel are `m.div`s wearing the presets from lib/motion - the scrim fades,
// the modal shrinks its two percent, the side panel slides back off its edge.
//
// Escape closes, and Headless UI marks the event handled. That matters: the
// shell clears the catalog selection on an unhandled Escape, and a reader
// dismissing a sheet was closing a sheet, not deselecting anything.

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import type { ReactNode } from "react";
import { AnimatePresence, fade, m, scaleIn, slideFrom } from "../lib/motion";

const SCRIM = "color-mix(in srgb, #000 45%, transparent)";

export function Modal({
  open,
  onClose,
  label,
  children,
  width = "min(680px,92vw)",
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  /** Any CSS width; the default is the palette's. */
  width?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <Dialog static open={open} onClose={onClose} className="relative z-50">
          <DialogBackdrop
            as={m.div}
            {...fade}
            className="fixed inset-0"
            style={{ background: SCRIM }}
          />
          {/* The scrim is a sibling of the panel and both are fixed, so the
              click that lands outside the panel lands on this box - which is
              what Headless UI watches to close. */}
          <div className="fixed inset-0 flex items-start justify-center pt-[12vh]">
            <DialogPanel
              as={m.div}
              {...scaleIn}
              aria-label={label}
              className="flex max-h-[70vh] flex-col overflow-hidden rounded-modal border bg-canvas border-line-strong shadow-md"
              style={{ width }}
            >
              {children}
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}

export function SidePanel({
  open,
  onClose,
  side,
  label,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  label: string;
  children: ReactNode;
  /** Any CSS width. */
  width: string;
}) {
  const left = side === "left";
  return (
    <AnimatePresence>
      {open && (
        <Dialog static open={open} onClose={onClose} className="relative z-40">
          <DialogBackdrop
            as={m.div}
            {...fade}
            className="fixed inset-0"
            style={{ background: SCRIM }}
          />
          <div
            className={`fixed inset-0 flex `}
          >
            {/* Arrives from the edge it belongs to, at the panel duration, and
                leaves by the same edge: it is a panel, it has just run out of
                room to be one. */}
            <DialogPanel
              as={m.div}
              {...slideFrom(left ? "-100%" : "100%")}
              aria-label={label}
              className={` h-full shadow-md`}
              style={{ width }}
            >
              {children}
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}
