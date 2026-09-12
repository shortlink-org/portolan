// A recording's trial, remembered across a reload.
//
// Keeping a recording writes portolan.json and then regenerates the catalog,
// and each of those reloads the page in development - the manifest and the
// sources are imported, not fetched. The runs go on in the server, which
// keeps every run's events and replays them to whoever asks; what is lost is
// the dialog watching them. So the page writes down which run it was
// watching, and the dialog picks the run back up when the page comes back.

export interface TraceTrialMemory {
  /** The trial run the dialog was opened on. */
  runId: string;
  /** The write run started by keeping the recording, once there is one. */
  writeRunId: string | null;
}

/** The storage this reads and writes: sessionStorage in the browser, anything shaped like it in a test. */
export interface TrialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "portolan.trace-trial.v1";

/**
 * `scope` says which page was watching: a flow's slug, or "settings". A
 * memory left by one page is not picked up by another - a dialog that pops
 * up on a page the reader did not open it on is a surprise, not a resume.
 */
export function rememberTraceTrial(
  storage: TrialStorage | null,
  scope: string,
  memory: TraceTrialMemory,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ scope, ...memory }));
  } catch {
    // Storage full or forbidden: the dialog simply does not survive a reload.
  }
}

export function recallTraceTrial(
  storage: TrialStorage | null,
  scope: string,
): TraceTrialMemory | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TraceTrialMemory> & { scope?: unknown };
    if (value.scope !== scope || typeof value.runId !== "string" || !value.runId) return null;

    return { runId: value.runId, writeRunId: typeof value.writeRunId === "string" ? value.writeRunId : null };
  } catch {
    return null;
  }
}

export function forgetTraceTrial(storage: TrialStorage | null): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget, or nowhere to forget it from.
  }
}

/** The browser's session storage, or null where there is none. */
export function sessionStore(): TrialStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
