import { useCallback, useEffect, useState } from "react";
import { Switch } from "@headlessui/react";
import {
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
  DeliveryFeatureId,
  DeliveryPreset,
  DeliveryProvider,
} from "../../lib/local-api";

const STATUS_CLASS: Record<
  DeliveryPreset["files"][number]["status"],
  string
> = {
  added: "status-verified",
  changed: "status-declared",
  removed: "status-unresolved",
  unchanged: "status-verified",
  conflict: "status-unresolved",
};

export function DeliverySettings({ local }: { local: boolean }) {
  const [plan, setPlan] = useState<DeliveryPreset | null>(null);
  const [loading, setLoading] = useState(local);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const say = useToastStore((state) => state.say);

  const load = useCallback(async (provider?: DeliveryProvider, features?: DeliveryFeatureId[]) => {
    if (!local) return;
    setLoading(true);
    setError("");
    try {
      setPlan(await previewDeliveryPreset(provider, features));
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
        plan.features.filter((feature) => feature.selected).map((feature) => feature.id),
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

  function selectFeature(id: DeliveryFeatureId) {
    if (!plan) return;
    const feature = plan.features.find((item) => item.id === id);
    if (!feature?.available) return;
    const selected = new Set(
      plan.features.filter((item) => item.selected).map((item) => item.id),
    );
    if (selected.has(id)) {
      selected.delete(id);
      if (id === "diff") selected.delete("sarif");
    } else {
      selected.add(id);
      for (const required of feature.requires) selected.add(required);
    }
    void load(plan.provider, [...selected]);
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
            Choose the automation this repository needs, preview the generated
            jobs, then install them together.
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
              onClick={() => void load(
                provider,
                plan?.features
                  .filter((feature) => feature.selected && (feature.id !== "sarif" || provider === "github"))
                  .map((feature) => feature.id),
              )}
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

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {plan.features.map((feature) => (
              <div
                key={feature.id}
                className={`flex items-start gap-3 rounded-control border px-3 py-3 transition-colors ${
                  feature.available
                    ? feature.selected
                      ? "border-accent bg-surface"
                      : "border-line hover:bg-surface"
                    : "border-line opacity-60"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{feature.label}</span>
                  <span className="mt-0.5 block text-muted">{feature.description}</span>
                  {!feature.available ? (
                    <span className="mt-1 block text-faint">Available for GitHub only.</span>
                  ) : feature.requires.length > 0 ? (
                    <span className="mt-1 block text-faint">
                      Enables {feature.requires.map((required) => plan.features.find((item) => item.id === required)?.label).join(", ")}.
                    </span>
                  ) : null}
                </span>
                <Switch
                  checked={feature.selected}
                  disabled={!feature.available || loading || installing}
                  onChange={() => selectFeature(feature.id)}
                  aria-label={feature.label}
                  className="group mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface transition-colors outline-none data-checked:border-accent data-checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed"
                >
                  <span
                    aria-hidden
                    className="size-3.5 translate-x-0.5 rounded-full bg-muted shadow-xs transition-transform group-data-checked:translate-x-[18px] group-data-checked:bg-canvas"
                  />
                </Switch>
              </div>
            ))}
          </div>

          {plan.files.length > 0 ? <div className="mt-4 divide-y divide-line overflow-hidden rounded-control border border-line">
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
          </div> : <div className="empty mt-4">No delivery jobs selected.</div>}

          {error ? <p className="mt-3 text-unresolved">{error}</p> : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-faint">
              Only files shown above will be written. Existing unmanaged
              workflows are never replaced.
            </p>
            {plan.status === "installed" ? (
              <span className="flex items-center gap-1.5 text-verified">
                <ShieldCheck size={15} /> Selection installed
              </span>
            ) : (
              <button
                type="button"
                className="product-primary"
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
