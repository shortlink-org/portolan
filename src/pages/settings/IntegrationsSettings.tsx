import { ExternalLink, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { SectionTitle } from "../../components/PageHeader";
import { TechIcon } from "../../components/TechIcon";
import { normalizeKafkaUiUrl, useKafkaUi } from "../../lib/kafka-ui";
import { techGlyph } from "../../lib/tech";

const FIELD =
  "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";

function KafkaUiCard() {
  const configured = useKafkaUi((state) => state.url);
  const setUrl = useKafkaUi((state) => state.setUrl);
  const [draft, setDraft] = useState(configured);
  const normalized = normalizeKafkaUiUrl(draft);
  const valid = normalized !== null;
  const dirty = valid && normalized !== configured;
  const glyph = techGlyph("Kafka");

  const save = () => {
    if (normalized === null) return;
    setUrl(normalized);
    setDraft(normalized);
  };

  const remove = () => {
    setUrl("");
    setDraft("");
  };

  return (
    <section className="rounded-card border border-line bg-canvas p-card shadow-xs">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink">
          {glyph ? <TechIcon glyph={glyph} size={18} /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-ink">Kafka UI</h2>
            <span className={`chip ${configured ? "status-verified" : "text-muted"}`}>
              {configured ? "configured" : "not configured"}
            </span>
          </div>
          <p className="mt-1 text-muted">
            Opens catalogued Kafka topics in your Kafbat Kafka UI installation.
          </p>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="label mb-1.5 block">Kafka UI cluster URL</span>
        <input
          type="url"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) save();
          }}
          placeholder="https://kafka.example/ui/clusters/production"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!valid}
          className={`${FIELD} ${valid ? "" : "border-unresolved"}`}
        />
      </label>
      <p className={`mono mt-2 ${valid ? "text-muted" : "text-unresolved"}`}>
        {valid
          ? "Use a cluster or topics URL to open the exact topic. A plain installation URL opens Kafka UI itself."
          : "Enter an http:// or https:// URL."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="product-primary"
        >
          <Save size={14} aria-hidden />
          Save integration
        </button>
        {configured ? (
          <>
            <a
              href={configured}
              target="_blank"
              rel="noreferrer"
              className="tbtn px-3 py-1.5 text-ink"
            >
              Open Kafka UI
              <ExternalLink size={14} aria-hidden />
            </a>
            <button
              type="button"
              onClick={remove}
              className="tbtn ml-auto px-3 py-1.5 text-unresolved"
            >
              <Trash2 size={14} aria-hidden />
              Remove
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

export function IntegrationsSettings() {
  return (
    <section>
      <SectionTitle right="stored in this browser">Integrations</SectionTitle>
      <div className="grid gap-grid lg:grid-cols-2">
        <KafkaUiCard />
      </div>
    </section>
  );
}
