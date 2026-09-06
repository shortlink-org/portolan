// The reader's model, and the switch.
//
// One form, two places: the gear in the panel opens it in a modal, and the
// Settings page shows it under Appearance with the on/off switch above it.
// A key typed here goes to localStorage and nowhere else; the request it
// signs leaves the browser for the endpoint the reader named, not for us.

import { useState } from "react";
import { Eye, EyeOff, ExternalLink, KeyRound } from "lucide-react";
import { BUILD, PRESETS, ownReady, routeLabel } from "./flags";
import type { OwnModel } from "./flags";
import { useChatRoute, usePrefs } from "./prefs";

const FIELD =
  "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";

const EMPTY: OwnModel = { baseUrl: "", apiKey: "", model: "" };

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  trailing,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  trailing?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={`${FIELD} ${trailing ? "pr-9" : ""}`}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>
        ) : null}
      </div>
    </label>
  );
}

/** The endpoint, the key and the model; save, or forget. */
export function ModelForm({ onDone }: { onDone?: () => void }) {
  const own = usePrefs((s) => s.own);
  const setOwn = usePrefs((s) => s.setOwn);
  const route = useChatRoute();
  const [draft, setDraft] = useState<OwnModel>(own ?? EMPTY);
  const [shown, setShown] = useState(false);

  const preset = PRESETS.find((p) => p.baseUrl === draft.baseUrl.trim());
  const ready = ownReady(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(own ?? EMPTY);

  const save = () => {
    setOwn({
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    });
    onDone?.();
  };
  const forget = () => {
    setOwn(null);
    setDraft(EMPTY);
    onDone?.();
  };

  return (
    <div>
      <div className="mono flex items-center gap-2 text-muted">
        <KeyRound size={14} aria-hidden />
        {route.kind === "own"
          ? `answering with ${routeLabel(route)}`
          : route.kind === "proxy"
            ? "answering through the demo proxy"
            : "nothing answers yet"}
      </div>

      <div className="label mt-4 mb-1.5">presets</div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() =>
              setDraft((d) => ({ ...d, baseUrl: p.baseUrl, model: p.model }))
            }
            aria-pressed={preset?.id === p.id}
            className={`chip cursor-pointer transition-colors hover:border-accent hover:text-accent ${
              preset?.id === p.id ? "border-accent text-accent" : "border-line-strong"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <Field
          label="base URL"
          value={draft.baseUrl}
          onChange={(baseUrl) => setDraft((d) => ({ ...d, baseUrl }))}
          placeholder="https://…/v1 — any OpenAI-compatible chat endpoint"
        />
        <Field
          label={preset && !preset.key ? "API key (not needed here)" : "API key"}
          value={draft.apiKey}
          onChange={(apiKey) => setDraft((d) => ({ ...d, apiKey }))}
          placeholder={preset && !preset.key ? "" : "kept in this browser only"}
          type={shown ? "text" : "password"}
          trailing={
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              aria-label={shown ? "Hide the key" : "Show the key"}
              className="text-muted hover:text-ink"
            >
              {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </button>
          }
        />
        <Field
          label="model"
          value={draft.model}
          onChange={(model) => setDraft((d) => ({ ...d, model }))}
          placeholder={preset?.id === "openrouter" ? "e.g. a model with the :free suffix" : "model name"}
        />
      </div>

      {preset?.keysUrl ? (
        <a
          href={preset.keysUrl}
          target="_blank"
          rel="noreferrer"
          className="mono mt-2 inline-flex items-center gap-1 text-accent hover:underline"
        >
          get a {preset.name} key <ExternalLink size={12} aria-hidden />
        </a>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!ready || !dirty}
          className="mono rounded-control border border-accent px-3 py-1.5 text-accent transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-50"
        >
          use this model
        </button>
        {own ? (
          <button
            type="button"
            onClick={forget}
            className="mono rounded-control border border-line px-3 py-1.5 text-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {BUILD.proxyUrl ? "forget it, back to the demo proxy" : "forget it"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The Settings page's section: the switch, then the form. */
export function ChatSection() {
  const enabled = usePrefs((s) => s.enabled);
  const setEnabled = usePrefs((s) => s.setEnabled);
  const own = usePrefs((s) => s.own);
  // Untouched, the switch follows the build: on when there is a proxy to
  // answer, on once a model of the reader's own is set, off otherwise.
  const on = enabled ?? (BUILD.proxyUrl !== "" || ownReady(own));

  return (
    <div className="grid gap-grid lg:grid-cols-2">
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">ask the catalog</div>
        <div className="seg inline-flex" role="group" aria-label="Ask the catalog">
          <button
            type="button"
            aria-pressed={on}
            onClick={() => setEnabled(true)}
            className={on ? "is-on" : ""}
          >
            on
          </button>
          <button
            type="button"
            aria-pressed={!on}
            onClick={() => setEnabled(false)}
            className={on ? "" : "is-on"}
          >
            off
          </button>
        </div>
        <p className="mono mt-3 text-muted">
          {BUILD.proxyUrl
            ? "This build answers through a proxy that holds its own key. A model of your own, set on the right, takes over when it is filled in."
            : "This build has no proxy. Set a model of your own on the right, and the button appears in the top bar."}
        </p>
      </div>
      <div className="rounded-card border border-line p-card shadow-xs">
        <ModelForm />
      </div>
    </div>
  );
}
