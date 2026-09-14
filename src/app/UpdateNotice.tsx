import { useState } from "react";
import { ArrowUpCircle, ExternalLink, X } from "lucide-react";

import { toClipboard } from "../lib/clipboard";
import { portolanUpdate, type PortolanUpdate } from "../lib/update-info";

export const UPDATE_COMMAND =
  "npm install --save-dev @shortlink-org/portolan@latest";

export function changelogHref(update: PortolanUpdate) {
  return `https://github.com/shortlink-org/portolan/compare/${encodeURIComponent(update.current)}...${encodeURIComponent(update.latest)}`;
}

export function UpdateNotice({
  update = portolanUpdate,
}: {
  update?: PortolanUpdate | null;
}) {
  const [open, setOpen] = useState(true);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  if (!update || !open) return null;

  const copyCommand = () => {
    void toClipboard(UPDATE_COMMAND).then((ok) =>
      setCopy(ok ? "copied" : "failed"),
    );
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-accent/30 bg-accent/5 py-2 pl-gutter pr-16 text-sm text-ink sm:flex sm:flex-wrap sm:pr-gutter"
    >
      <ArrowUpCircle size={16} aria-hidden className="shrink-0 text-accent" />
      <p className="min-w-0 sm:mr-auto">
        <span className="font-medium">Portolan {update.latest} is available.</span>{" "}
        <span className="text-muted">
          You are running <span className="mono">{update.current}</span>.
        </span>
      </p>
      <div className="col-start-2 flex flex-wrap items-center gap-3 sm:contents">
        <a
          href={changelogHref(update)}
          target="_blank"
          rel="noreferrer"
          className="mono inline-flex shrink-0 items-center gap-1 text-muted hover:text-ink"
        >
          Changelog
          <ExternalLink size={13} aria-hidden />
        </a>
        <button
          type="button"
          onClick={copyCommand}
          className="tbtn shrink-0 px-2.5 py-1 text-accent"
        >
          {copy === "copied"
            ? "Command copied"
            : copy === "failed"
              ? "Copy failed"
              : "Copy update command"}
        </button>
      </div>
      <div className="absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-accent/20 sm:static sm:w-auto sm:self-stretch sm:pl-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss update notice"
          title="Dismiss"
          className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
