import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  FolderGit2,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useToastStore } from "../../app/toast";
import {
  installDeliveryPreset,
  previewDeliveryPreset,
} from "../../lib/local-api";
import type {
  DeliveryPreset,
  DeliveryProvider,
} from "../../lib/local-api";

const STATUS_CLASS: Record<
  DeliveryPreset["files"][number]["status"],
  string
> = {
  added: "status-verified",
  changed: "status-declared",
  unchanged: "status-verified",
  conflict: "status-unresolved",
};

export function DeliverySettings({ local }: { local: boolean }) {
  const [plan, setPlan] = useState<DeliveryPreset | null>(null);
  const [loading, setLoading] = useState(local);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const say = useToastStore((state) => state.say);

  const load = useCallback(async (provider?: DeliveryProvider) => {
    if (!local) return;
    setLoading(true);
    setError("");
    try {
      setPlan(await previewDeliveryPreset(provider));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [local]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    if (!plan) return;
    setInstalling(true);
    setError("");
    try {
      const installed = await installDeliveryPreset(
        plan.provider,
        plan.revision,
      );
      setPlan(installed);
      say(
        installed.written.length === 1
          ? `${installed.written[0]} installed`
          : `${installed.written.length} delivery files installed`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      say(message);
    } finally {
      setInstalling(false);
    }
  }

  if (!local) {
    return (
      <div className="empty">
        Start <code>portolan dev</code> to preview and install delivery presets
        in this repository.
      </div>
    );
  }

  const conflicts =
    plan?.files.filter((file) => file.status === "conflict") ?? [];

  return (
    <div className="rounded-card border border-line p-card shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-ink">
            <FolderGit2 size={16} className="text-accent" /> Delivery automation
          </div>
          <p className="mt-1 max-w-prose text-muted">
            Install review checks and static catalog publishing directly into
            this repository.
          </p>
        </div>
        <div
          className="seg inline-flex"
          role="group"
          aria-label="Delivery provider"
        >
          {(["github", "gitlab"] as const).map((provider) => (
            <button
              key={provider}
              type="button"
              disabled={loading || installing}
              aria-pressed={plan?.provider === provider}
              onClick={() => void load(provider)}
              className={`capitalize ${plan?.provider === provider ? "is-on" : ""}`}
            >
              {provider === "github" ? "GitHub" : "GitLab"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-muted">
          <LoaderCircle size={15} className="animate-spin" /> Inspecting
          repository…
        </div>
      ) : error && !plan ? (
        <div className="mt-4 rounded-control border border-line bg-surface px-3 py-2 text-unresolved">
          {error}
        </div>
      ) : plan ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`chip ${
                plan.status === "conflict"
                  ? "status-unresolved"
                  : plan.status === "update"
                    ? "status-declared"
                    : "status-verified"
              }`}
            >
              {plan.status}
            </span>
            <span className="mono text-muted">
              {plan.repository} · {plan.defaultBranch}
            </span>
            {plan.detectedProvider === plan.provider ? (
              <span className="text-faint">detected from origin</span>
            ) : plan.detectedProvider ? (
              <span className="text-faint">
                origin uses {plan.detectedProvider === "github" ? "GitHub" : "GitLab"}
              </span>
            ) : (
              <span className="text-faint">provider selected manually</span>
            )}
          </div>

          <ul className="mt-4 grid gap-2 text-muted sm:grid-cols-2">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <Check size={14} className="shrink-0 text-verified" /> {feature}
              </li>
            ))}
          </ul>

          <div className="mt-4 divide-y divide-line overflow-hidden rounded-control border border-line">
            {plan.files.map((file) => (
              <details
                key={file.path}
                className="group"
                open={file.status === "conflict"}
              >
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface">
                  <span className={`chip ${STATUS_CLASS[file.status]}`}>
                    {file.status}
                  </span>
                  <span className="mono truncate text-ink">{file.path}</span>
                  <ChevronDown
                    size={15}
                    className="ml-auto shrink-0 text-muted transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t border-line bg-surface">
                  {file.message ? (
                    <p className="flex items-center gap-2 px-3 pt-3 text-unresolved">
                      <CircleAlert size={14} /> {file.message}
                    </p>
                  ) : null}
                  <pre className="mono max-h-72 overflow-auto whitespace-pre p-3 text-muted">
                    {file.diff || "No changes — this file is up to date."}
                  </pre>
                </div>
              </details>
            ))}
          </div>

          {error ? <p className="mt-3 text-unresolved">{error}</p> : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-faint">
              Only files shown above will be written. Existing unmanaged
              workflows are never replaced.
            </p>
            {plan.status === "installed" ? (
              <span className="flex items-center gap-1.5 text-verified">
                <ShieldCheck size={15} /> Preset installed
              </span>
            ) : (
              <button
                type="button"
                className="btn-accent"
                disabled={installing || conflicts.length > 0}
                onClick={() => void install()}
              >
                {installing ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Play size={15} />
                )}
                {plan.status === "update" ? "Update preset" : "Install preset"}
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
