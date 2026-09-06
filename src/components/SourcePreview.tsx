import {
  Code2,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Pin,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useForgeAccess } from "../app/forge-access";
import {
  loadSourceCode,
  sourceLanguage,
  sourceWindow,
  SourceLoadError,
} from "../lib/source-code";
import type { SourceFile } from "../lib/source-code";
import { highlightSource } from "../lib/source-highlight";
import type { HighlightNode } from "../lib/source-highlight";
import type { SourceLocation } from "../lib/source-link";

const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 140;
const PANEL_WIDTH = 720;
const PANEL_HEIGHT = 430;
const EDGE = 8;

type Position = { left: number; top: number; width: number; maxHeight: number };

function positionFor(trigger: DOMRect): Position {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - EDGE * 2);
  const maxHeight = Math.min(PANEL_HEIGHT, window.innerHeight - EDGE * 2);
  const left = Math.max(
    EDGE,
    Math.min(trigger.left, window.innerWidth - width - EDGE),
  );
  const below = window.innerHeight - trigger.bottom - EDGE;
  const top =
    below >= Math.min(maxHeight, 260)
      ? trigger.bottom + 6
      : Math.max(EDGE, trigger.top - maxHeight - 6);
  return { left, top, width, maxHeight };
}

function AccessForm({
  location,
  message,
}: {
  location: Extract<SourceLocation, { kind: "remote" }>;
  message: string;
}) {
  const access = useForgeAccess();
  const [draft, setDraft] = useState("");
  const connected = access.connectedTo(location.origin);
  const provider = location.provider === "github" ? "GitHub" : "GitLab";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    access.connect(location.origin, draft);
    setDraft("");
  };

  return (
    <div className="p-4">
      <div className="flex items-start gap-2 text-ink">
        <LockKeyhole
          size={16}
          className="mt-0.5 shrink-0 text-accent"
          aria-hidden
        />
        <div>
          <div className="font-medium">Repository access required</div>
          <p className="mt-1 text-sm text-muted">{message}</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{provider} read-only access token</span>
          <input
            type="password"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={`${provider} read-only access token`}
            className="mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="btn-accent shrink-0 disabled:opacity-40"
        >
          {connected ? "Replace token" : "Connect"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Kept only in this tab&apos;s memory. Never written to URLs, Web Storage,
        or Cache Storage.
      </p>
      {connected ? (
        <button
          type="button"
          className="mono mt-3 text-xs text-muted hover:text-ink"
          onClick={() => access.disconnect(location.origin)}
        >
          Forget current token
        </button>
      ) : null}
    </div>
  );
}

function CodeWindow({
  file,
  location,
}: {
  file: SourceFile;
  location: SourceLocation;
}) {
  const rows = useMemo(
    () => sourceWindow(file.content, location.line),
    [file.content, location.line],
  );
  const highlighted = useMemo(
    () => highlightSource(location.path, rows.map((row) => row.text).join("\n")),
    [location.path, rows],
  );
  const focusedIndex = rows.findIndex((row) => row.focused);

  const renderNode = (node: HighlightNode, key: string): ReactNode => {
    if (node.type === "text") return node.value;
    const names = node.properties?.className;
    const className = Array.isArray(names)
      ? names.filter((name): name is string => typeof name === "string").join(" ")
      : typeof names === "string"
        ? names
        : undefined;
    return (
      <span key={key} className={className}>
        {node.children.map((child, index) =>
          renderNode(child, `${key}-${index}`),
        )}
      </span>
    );
  };

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-canvas py-2 text-[12px] leading-5"
      tabIndex={0}
    >
      <div className="mono relative grid min-w-max grid-cols-[4rem_minmax(max-content,1fr)] text-ink">
        {focusedIndex >= 0 ? (
          <span
            className="pointer-events-none absolute inset-x-0 h-5 bg-accent/10"
            style={{ top: `${focusedIndex * 20}px` }}
            aria-hidden
          />
        ) : null}
        <div className="relative z-10">
          {rows.map((row) => (
            <div
              key={row.number}
              className={`h-5 select-none border-r pr-3 text-right ${row.focused ? "border-accent text-accent" : "border-line text-muted"}`}
              aria-hidden
            >
              {row.number}
            </div>
          ))}
        </div>
        <pre className="source-code relative z-10 min-w-max pl-3 pr-4 text-ink">
          <code>{highlighted.map((node, index) => renderNode(node, String(index)))}</code>
        </pre>
      </div>
    </div>
  );
}

function PreviewPanel({
  id,
  location,
  pinned,
  position,
  panelRef,
  onEnter,
  onLeave,
  onClose,
}: {
  id: string;
  location: SourceLocation;
  pinned: boolean;
  position: Position;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const access = useForgeAccess();
  const token =
    location.kind === "remote" ? access.tokenFor(location.origin) : "";
  const [file, setFile] = useState<SourceFile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    setLoading(true);
    loadSourceCode(location, token)
      .then((result) => {
        if (live) setFile(result);
      })
      .catch((cause: unknown) => {
        if (live)
          setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [location, token]);

  const auth =
    location.kind === "remote" &&
    error instanceof SourceLoadError &&
    error.authRequired;
  const ref =
    location.kind === "remote" ? location.ref.slice(0, 12) : "working tree";

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-label={`Source preview for ${location.path}`}
      tabIndex={-1}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="fixed z-[80] flex overflow-hidden rounded-control border border-line-strong bg-canvas shadow-md outline-none"
      style={
        {
          position: "fixed",
          zIndex: 80,
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          minHeight: 180,
        } satisfies CSSProperties
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
          <Code2 size={15} className="shrink-0 text-accent" aria-hidden />
          <span
            className="mono min-w-0 flex-1 truncate text-xs text-ink"
            title={location.path}
          >
            {location.path}
          </span>
          <span className="chip mono shrink-0">
            {sourceLanguage(location.path)}
          </span>
          <span className="mono shrink-0 text-[11px] text-muted">{ref}</span>
          {pinned ? (
            <Pin
              size={13}
              className="shrink-0 text-accent"
              aria-label="Preview pinned"
            />
          ) : null}
          {location.href ? (
            <a
              href={location.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-control p-1 text-muted hover:bg-raised hover:text-accent"
              aria-label="Open source on the forge"
              title="Open on the forge"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-muted hover:bg-raised hover:text-ink"
            aria-label="Close source preview"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        {loading ? (
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted">
            <LoaderCircle size={16} className="animate-spin" aria-hidden />{" "}
            Loading source…
          </div>
        ) : auth ? (
          <AccessForm location={location} message={error.message} />
        ) : error ? (
          <div className="p-4 text-sm text-muted">{error.message}</div>
        ) : file ? (
          <CodeWindow file={file} location={location} />
        ) : null}
      </div>
    </div>
  );
}

/** Hover/focus for a glance; click pins the same preview for scrolling and copying. */
export function SourcePreviewButton({
  location,
  className = "",
}: {
  location: SourceLocation | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useMemo(
    () => `source-preview-${Math.random().toString(36).slice(2)}`,
    [],
  );

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelTimer();
    pinnedRef.current = false;
    setOpen(false);
    setPinned(false);
  }, [cancelTimer]);
  const openSoon = useCallback(() => {
    cancelTimer();
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, [cancelTimer]);
  const closeSoon = useCallback(() => {
    if (pinnedRef.current) return;
    cancelTimer();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelTimer]);

  useEffect(() => () => cancelTimer(), [cancelTimer]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (triggerRef.current)
        setPosition(positionFor(triggerRef.current.getBoundingClientRect()));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!pinned) return;
    const outside = (event: globalThis.PointerEvent) => {
      const node = event.target as Node;
      if (
        !triggerRef.current?.contains(node) &&
        !panelRef.current?.contains(node)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [close, pinned]);

  if (!location) return null;

  const hover = (event: ReactPointerEvent) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen")
      openSoon();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`mono inline-flex items-center gap-1 rounded-control text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${className}`}
        title="Preview source · click to pin"
        onPointerEnter={hover}
        onPointerLeave={closeSoon}
        onFocus={() => setOpen(true)}
        onBlur={closeSoon}
        onClick={() => {
          cancelTimer();
          if (open && pinned) {
            close();
            return;
          }
          setOpen(true);
          pinnedRef.current = true;
          setPinned(true);
          setTimeout(() => panelRef.current?.focus(), 0);
        }}
      >
        <Code2 size={13} aria-hidden /> preview
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <PreviewPanel
              id={id}
              location={location}
              pinned={pinned}
              position={position}
              panelRef={panelRef}
              onEnter={cancelTimer}
              onLeave={closeSoon}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </>
  );
}
