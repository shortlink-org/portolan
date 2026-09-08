// The panel's top line: what this is, who answers, and three controls.

import { Eraser, MessageSquare, Settings2, X } from "lucide-react";
import { routeLabel } from "./flags";
import type { ChatRoute } from "./flags";

const ICON =
  "flex size-8 items-center justify-center rounded-control text-muted t-micro transition-colors hover:bg-surface hover:text-ink";

export function Header({
  route,
  onSettings,
  onClear,
  onClose,
}: {
  route: ChatRoute;
  onSettings: () => void;
  /** Present once there is a conversation to start over from. */
  onClear?: () => void;
  /** Omitted when the conversation is embedded in a page. */
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
      <MessageSquare size={16} aria-hidden className="shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="font-semibold leading-tight text-ink">
          ask the catalog
        </div>
        <div className="mono truncate text-muted">
          {routeLabel(route) || "nothing set to answer"}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="New conversation"
            title="New conversation"
            className={ICON}
          >
            <Eraser size={15} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSettings}
          aria-label="Model settings"
          title="Model settings"
          className={ICON}
        >
          <Settings2 size={15} aria-hidden />
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close — Esc"
            className={ICON}
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
