import { LoaderCircle, Trash2 } from "lucide-react";
import type { SetupProject } from "../../lib/setup-info";
import { Modal } from "../../components/Overlay";
import { AnimatePresence, m, rise } from "../../lib/motion";

export function RemoveProjectDialog({
  project,
  busy,
  onClose,
  onConfirm,
}: {
  project: SetupProject | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const name = project?.name ?? "project";
  return (
    <Modal
      open={project !== null}
      onClose={busy ? () => {} : onClose}
      label={`Remove ${name}`}
      width="min(520px,92vw)"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <m.span
          animate={busy ? { rotate: 360 } : { rotate: 0 }}
          transition={busy ? { duration: 0.9, ease: "linear", repeat: Infinity } : undefined}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-unresolved/10 text-unresolved"
        >
          {busy ? <LoaderCircle size={17} aria-hidden /> : <Trash2 size={16} aria-hidden />}
        </m.span>
        <div className="min-w-0">
          <div className="font-semibold text-ink">{busy ? `Removing ${name}` : `Remove ${name}?`}</div>
          <div className="mono mt-0.5 truncate text-faint">{project?.id}</div>
        </div>
      </div>

      <div className="min-h-40 p-5">
        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <m.div key="removing" {...rise} aria-live="polite">
              <p className="font-medium text-ink">Updating project configuration…</p>
              <p className="mt-2 text-muted">
                Portolan is removing the project and its extraction steps. The source tree remains untouched.
              </p>
              <div
                role="progressbar"
                aria-label={`Removing ${name}`}
                className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface"
              >
                <m.div
                  className="h-full w-2/5 rounded-full bg-unresolved"
                  initial={{ x: "-100%" }}
                  animate={{ x: ["-100%", "250%"] }}
                  transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
                />
              </div>
            </m.div>
          ) : (
            <m.div key="confirm" {...rise}>
              <p className="text-muted">
                This removes the project, its extraction steps and its dedicated catalog configuration from <span className="mono text-ink">portolan.json</span>. Your source code stays untouched.
              </p>
              <p className="mt-3 text-muted">
                You can undo immediately. Generated documentation changes remain pending until you preview and apply them.
              </p>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" className="tbtn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="product-primary product-danger min-w-36" onClick={onConfirm} disabled={busy}>
          <AnimatePresence mode="wait" initial={false}>
            <m.span key={busy ? "busy" : "ready"} {...rise} className="flex items-center justify-center gap-2">
              {busy ? <LoaderCircle size={15} aria-hidden /> : <Trash2 size={15} aria-hidden />}
              {busy ? "Removing…" : "Remove project"}
            </m.span>
          </AnimatePresence>
        </button>
      </div>
    </Modal>
  );
}
