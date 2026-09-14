import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  ExternalLink,
  FileJson2,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useToastStore } from "../../app/toast";
import { SectionTitle } from "../../components/PageHeader";
import { TechIcon } from "../../components/TechIcon";
import { activeCatalogProfile } from "../../data";
import { toClipboard } from "../../lib/clipboard";
import { useConfluence } from "../../lib/confluence";
import { dxIntegrationModel, summarizeDxPlan } from "../../lib/dx-integration";
import type { DxPlanSummary } from "../../lib/dx-integration";
import { normalizeIntegrationUrl } from "../../lib/integration-url";
import type { IntegrationState } from "../../lib/integration-url";
import { useKafkaUi } from "../../lib/kafka-ui";
import { useNotion } from "../../lib/notion";
import { setupInfo } from "../../lib/setup-info";
import { techGlyph } from "../../lib/tech";
import { TaskTrackerSettings } from "./TaskTrackerSettings";

const FIELD =
  "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
const base = import.meta.env.BASE_URL;

function IntegrationCard({
  name,
  brand,
  summary,
  label,
  placeholder,
  hint,
  store,
}: {
  /** The heading, and what the open button says. */
  name: string;
  /** The brand whose mark sits beside the heading. */
  brand: string;
  summary: string;
  label: string;
  placeholder: string;
  /** What a valid URL means: shown under the field. */
  hint: string;
  store: UseBoundStore<StoreApi<IntegrationState>>;
}) {
  const configured = store((state) => state.url);
  const setUrl = store((state) => state.setUrl);
  const [draft, setDraft] = useState(configured);
  const normalized = normalizeIntegrationUrl(draft);
  const valid = normalized !== null;
  const dirty = valid && normalized !== configured;
  const glyph = techGlyph(brand);

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
            <h2 className="font-semibold text-ink">{name}</h2>
            <span className={`chip ${configured ? "status-verified" : "text-muted"}`}>
              {configured ? "configured" : "not configured"}
            </span>
          </div>
          <p className="mt-1 text-muted">{summary}</p>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="label mb-1.5 block">{label}</span>
        <input
          type="url"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) save();
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!valid}
          className={`${FIELD} ${valid ? "" : "border-unresolved"}`}
        />
      </label>
      <p className={`mono mt-2 ${valid ? "text-muted" : "text-unresolved"}`}>
        {valid ? hint : "Enter an http:// or https:// URL."}
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
              Open {name}
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

function useDxPlan(href: string | undefined) {
  const [state, setState] = useState<
    { status: "idle" | "loading" | "ready" | "failed"; summary?: DxPlanSummary }
  >({ status: href ? "loading" : "idle" });

  useEffect(() => {
    if (!href) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(href, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`http ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((value) => setState({ status: "ready", summary: summarizeDxPlan(value) }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [href]);

  return state;
}

function DxIntegration() {
  const say = useToastStore((state) => state.say);
  const model = dxIntegrationModel(setupInfo, activeCatalogProfile.id);
  const planHref = model.export ? `${base}${model.export.output}/plan.json` : undefined;
  const plan = useDxPlan(planHref);
  const planPath = model.export ? `${model.export.output}/plan.json` : "exports/dx/plan.json";
  const sourceStatus = !model.source
    ? "not configured"
    : model.sourceRun?.status === "failed"
      ? "failed"
      : model.sourceRun
        ? model.sourceMode
        : "configured";
  const exportStatus = !model.export
    ? "not configured"
    : model.exportRun?.status === "failed" || plan.status === "failed"
      ? "failed"
      : plan.status === "ready"
        ? "generated"
        : "configured";
  const finished = setupInfo.run?.finishedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(setupInfo.run.finishedAt))
    : "no recorded run";

  const copy = async (command: string, label: string) => {
    say(await toClipboard(command) ? `${label} copied` : "could not reach the clipboard");
  };

  return (
    <section className="rounded-card border border-line bg-canvas p-card shadow-xs lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink">DX Software Catalog</h2>
            <span className="chip text-muted">read-only UI</span>
          </div>
          <p className="mt-1 max-w-3xl text-muted">
            Input and output are independent pipeline adapters. This page reports what the build did; credentials and writes stay in CLI or CI.
          </p>
        </div>
        <span className="mono text-faint">catalog {activeCatalogProfile.id}</span>
      </div>

      <div className="mt-4 grid gap-grid lg:grid-cols-2">
        <div className="rounded-control border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-ink">
              <ArrowDownToLine size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">DX → Portolan</h3>
                <span className={`chip ${sourceStatus === "failed" ? "status-unresolved" : sourceStatus === "live" ? "status-verified" : "text-muted"}`}>
                  {sourceStatus}
                </span>
              </div>
              <p className="mt-1 text-muted">Entities and selected relations become a reproducible catalog fragment.</p>
            </div>
          </div>

          {model.source ? (
            <dl className="mono mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line pt-4 text-muted">
              <dt>output</dt><dd className="truncate text-ink">{model.source.output}/dx.catalog.json</dd>
              <dt>last run</dt><dd className="text-ink">{finished}</dd>
              <dt>files</dt><dd className="text-ink">{model.sourceRun?.fileCount ?? "—"}</dd>
            </dl>
          ) : (
            <p className="mono mt-4 border-t border-line pt-4 text-muted">
              Add a <span className="text-ink">dx-source</span> extract step to enable this direction.
            </p>
          )}
        </div>

        <div className="rounded-control border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-ink">
              <ArrowUpFromLine size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink">Portolan → DX</h3>
                <span className={`chip ${exportStatus === "failed" ? "status-unresolved" : exportStatus === "generated" ? "status-verified" : "text-muted"}`}>
                  {exportStatus}
                </span>
              </div>
              <p className="mt-1 text-muted">Generation produces a reviewable plan and never writes to DX.</p>
            </div>
          </div>

          {plan.summary ? (
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
              <div><dt className="label">entities</dt><dd className="mono tnum mt-1 text-lg text-ink">{plan.summary.entities}</dd></div>
              <div><dt className="label">edges</dt><dd className="mono tnum mt-1 text-lg text-ink">{plan.summary.edges}</dd></div>
              <div><dt className="label">relations</dt><dd className="mono tnum mt-1 text-lg text-ink">{plan.summary.relations}</dd></div>
            </dl>
          ) : (
            <p className="mono mt-4 border-t border-line pt-4 text-muted">
              {plan.status === "loading" ? "reading the generated plan…" : plan.status === "failed" ? "the generated plan could not be read" : "add a dx-export generate step for this catalog"}
            </p>
          )}

          {model.export ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={planHref} className="tbtn px-3 py-1.5 text-ink">
                <FileJson2 size={14} aria-hidden />
                Open plan
                <ExternalLink size={13} aria-hidden />
              </a>
              <button type="button" onClick={() => copy(`portolan dx apply ${planPath} --dry-run`, "Dry-run command")} className="tbtn px-3 py-1.5 text-ink">
                <Copy size={14} aria-hidden />
                Copy dry run
              </button>
              <button type="button" onClick={() => copy(`DX_API_TOKEN=... portolan dx apply ${planPath}`, "Apply command")} className="tbtn px-3 py-1.5 text-ink">
                <Copy size={14} aria-hidden />
                Copy apply
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-control border border-line bg-surface px-4 py-3">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-verified" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">Preflight before apply</span>
            <span className="chip status-verified">required</span>
          </div>
          <p className="mt-1 text-muted">CLI verifies entity types, properties and relation endpoints before its first write. The result is intentionally not cached or simulated by this static page.</p>
        </div>
      </div>
    </section>
  );
}

export function IntegrationsSettings({ local = false }: { local?: boolean }) {
  return (
    <section>
      <SectionTitle right="browser settings + build configuration">Integrations</SectionTitle>
      <div className="grid gap-grid lg:grid-cols-2">
        <TaskTrackerSettings local={local} />
        <DxIntegration />
        <IntegrationCard
          name="Kafka UI"
          brand="Kafka"
          summary="Opens catalogued Kafka topics in your Kafbat Kafka UI installation."
          label="Kafka UI cluster URL"
          placeholder="https://kafka.example/ui/clusters/production"
          hint="Use a cluster or topics URL to open the exact topic. A plain installation URL opens Kafka UI itself."
          store={useKafkaUi}
        />
        <IntegrationCard
          name="Confluence"
          brand="Confluence"
          summary="Searches your wiki for a service or context by name, from its page."
          label="Confluence site or space URL"
          placeholder="https://acme.atlassian.net/wiki/spaces/ARCH"
          hint="A space URL searches that space only. A site URL searches the whole wiki. Cloud and Server are both understood."
          store={useConfluence}
        />
        <IntegrationCard
          name="Notion"
          brand="Notion"
          summary="Opens the Notion workspace where the documentation lives, from a service or context page."
          label="Notion workspace or teamspace URL"
          placeholder="https://www.notion.so/acme"
          hint="Notion has no search address, so every page opens this URL as it is."
          store={useNotion}
        />
      </div>
    </section>
  );
}
