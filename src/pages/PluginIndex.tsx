import { useDocumentTitle } from "../app/title";
import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { ArrowUpRight, ShieldCheck, Terminal } from "lucide-react";
import { SectionTitle } from "../components/PageHeader";
import {
  pluginsByCategory,
  pluginLabel,
  pluginSourceHref,
  runtimeLabel,
} from "../lib/plugins";
import type { PluginEntry } from "../lib/plugins";
import { PRODUCT_REPOSITORY } from "../lib/product";
import { paths } from "../routes";

const PHASE_LABEL = { extract: "extract", verify: "verify", generate: "generate" } as const;

/**
 * Every plugin the package ships, grouped by what it reads or what it makes.
 *
 * Rendered from the index `npm run schema` writes, so this page says what the
 * plugins say about themselves and nothing else: the summary each answers to
 * `describe`, the category it sorts itself under, the options it can be told.
 * The Settings page shows which of these a build ran; this one shows what a
 * build could run.
 */
export function PluginIndex() {
  useDocumentTitle("Plugins");
  const groups = pluginsByCategory();
  const total = groups.reduce((n, group) => n + group.plugins.length, 0);
  const { hash } = useLocation();
  const target = hash.startsWith("#plugin-") ? hash.slice("#plugin-".length) : null;

  // A link from Settings names one plugin. The card grid settles a frame after
  // the route commits, so the scroll waits for it rather than landing where
  // the card was in a layout that no longer exists.
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Plugins</h1>
        <span className="mono text-muted">{total} shipped</span>
      </div>
      <p className="mt-2 max-w-prose text-muted">
        Every fact in the catalog was read by one of these. An extractor reads a
        tree and answers with a fragment; a verifier checks the catalog against
        evidence; a generator turns it into something else. Each describes
        itself, and this page is that description. Which of them a build ran is
        on the{" "}
        <Link to={paths.settingsPipeline()} className="text-accent hover:underline">
          pipeline settings
        </Link>
        ; how to write one is in the{" "}
        <a
          href={`${PRODUCT_REPOSITORY}/tree/main/plugins#readme`}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          plugin protocol
        </a>
        .
      </p>

      <nav aria-label="Categories" className="mt-4 flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <a key={group.category} href={`#${group.category}`} className="chip border-line-strong hover:border-accent hover:text-accent">
            {group.title} <span className="text-muted/70">{group.plugins.length}</span>
          </a>
        ))}
      </nav>

      <div className="mt-section space-y-section">
        {groups.map((group) => (
          <section key={group.category} id={group.category} className="scroll-mt-4">
            <SectionTitle anchor={group.category} right={<span className="mono text-muted">{group.plugins.length}</span>}>
              {group.title}
            </SectionTitle>
            <p className="mb-3 max-w-prose text-muted">{group.what}</p>
            <div className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
              {group.plugins.map((entry) => (
                <PluginCard key={entry.name} entry={entry} highlighted={entry.name === target} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PluginCard({ entry, highlighted }: { entry: PluginEntry; highlighted: boolean }) {
  const options = Object.entries(entry.options.properties ?? {});
  const required = new Set(entry.options.required ?? []);
  const RuntimeIcon = entry.runtime === "wasm" ? ShieldCheck : Terminal;
  const runtimeTone = entry.runtime === "wasm" ? "text-verified" : "text-declared";

  return (
    <article
      id={`plugin-${entry.name}`}
      // The margin clears the section head, which stays stuck to the top
      // while its cards scroll under it.
      className={`card card-static flex scroll-mt-14 flex-col gap-3 ${highlighted ? "border-accent" : ""}`}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-semibold text-ink">{pluginLabel(entry.name)}</h3>
        <span className="mono text-muted" title="the name a manifest step uses">{entry.name}</span>
        {entry.plugin !== entry.name ? (
          <span className="mono text-faint" title="the plugin's own name">{entry.plugin}</span>
        ) : null}
      </header>

      <p className="text-muted">{entry.summary}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {entry.phases.map((phase) => (
          <span key={phase} className="chip border-line-strong">{PHASE_LABEL[phase]}</span>
        ))}
        <span className={`chip inline-flex items-center gap-1 border-line-strong ${runtimeTone}`}>
          <RuntimeIcon size={12} aria-hidden /> {runtimeLabel(entry)}
        </span>
        {entry.needs?.map((need) => (
          <span key={need} className="chip border-line-strong" title="asked of the host beyond the tree">
            needs {need}
          </span>
        ))}
      </div>

      {options.length > 0 ? (
        <details className="group">
          <summary className="mono cursor-pointer list-none text-muted hover:text-ink">
            {options.length} option{options.length === 1 ? "" : "s"}
            <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <dl className="mt-2 space-y-2 border-l border-line pl-3">
            {options.map(([key, option]) => (
              <div key={key}>
                <dt className="mono text-ink">
                  {key}
                  {required.has(key) ? <span className="ml-1 text-faint" title="required">*</span> : null}
                </dt>
                {option.description ? <dd className="text-muted">{option.description}</dd> : null}
              </div>
            ))}
          </dl>
        </details>
      ) : (
        <p className="mono text-faint">takes no options</p>
      )}

      <a
        href={pluginSourceHref(entry)}
        target="_blank"
        rel="noreferrer"
        className="mono mt-auto inline-flex items-center gap-1 text-accent hover:underline"
      >
        {entry.source} <ArrowUpRight size={12} aria-hidden />
      </a>
    </article>
  );
}
