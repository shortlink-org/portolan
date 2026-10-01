import { Link } from "react-router";
import { ChevronDown, ShieldCheck, Terminal } from "lucide-react";
import { plural } from "../../lib/format";
import type { SetupPhase, SetupPlugin } from "../../lib/setup-info";
import { pluginByName, pluginIcon } from "../../lib/plugins";
import { PluginIcon } from "../../components/PluginIcon";
import { paths } from "../../routes";
import { CapabilityEmpty, Empty, SectionTitle } from "../../components/PageHeader";
import { MachineDocs } from "../../components/MachineDocs";
import { useSetup } from "./setup";
import { healthFor, HEALTH_LABEL, HealthBadge } from "./health";
import type { Health } from "./health";
import { FileLink, PipelineSteps } from "./PipelineSteps";

const PHASE_LABEL: Record<SetupPhase, string> = { extract: "extract", verify: "verify", generate: "generate" };

/* Fifteen of sixteen plugins run as a host process, so spelling it out on
   every row was fifteen repetitions of the word to make the one that differs
   findable. The icon carries it on the row and the legend under the list says
   what the two mean; the name stays for the reader who opens a row. */
function Runtime({ plugin, icon = false }: { plugin: SetupPlugin; icon?: boolean }) {
  const [Icon, tone, name] =
    plugin.runtime === "wasm"
      ? ([ShieldCheck, "text-verified", "WASM sandbox"] as const)
      : plugin.runtime === "host"
        ? ([Terminal, "text-declared", "in the host"] as const)
        : ([Terminal, "text-declared", "host process"] as const);
  return icon ? (
    <span className={tone} title={name}>
      <Icon size={14} aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1.5 ${tone}`}><Icon size={14} aria-hidden /> {name}</span>
  );
}

/* Health is the same word on nearly every row too. A dot states it without
   spending a column on it, and the badge comes back the moment it is not
   "healthy" - which is the only time anyone is reading this column. */
function HealthDot({ health }: { health: Health }) {
  const tone =
    health === "healthy"
      ? "bg-verified"
      : health === "changed"
        ? "bg-declared"
        : health === "failed"
          ? "bg-unresolved"
          : "bg-line-strong";
  return (
    <span className={`size-1.5 shrink-0 rounded-full ${tone}`} title={HEALTH_LABEL[health]}>
      <span className="sr-only">{HEALTH_LABEL[health]}</span>
    </span>
  );
}

const PHASE_ORDER: SetupPhase[] = ["extract", "verify", "generate"];

/**
 * The sixteen plugins, grouped by the phase they run in.
 *
 * It was a five-column table, and four of the columns said the same thing on
 * nearly every row: the phase (thirteen say "extract"), the runtime (fifteen
 * say "host process"), the status (sixteen say "healthy"). A table is for
 * columns that differ. The phase became the group it sorts into, the runtime
 * and the status became a mark, and what is left on the row is the name and
 * the one number that varies. The detail every row could open is unchanged.
 */
function PluginsList() {
  const setupInfo = useSetup();
  if (setupInfo.plugins.length === 0) return <Empty>this build ran no plugins</Empty>;
  const projectNames = new Map(setupInfo.projects.map((project) => [project.id, project.name]));
  const groups = [
    ...PHASE_ORDER.map((phase) => ({
      key: phase as string,
      label: PHASE_LABEL[phase],
      plugins: setupInfo.plugins.filter((plugin) => plugin.phases[0] === phase),
    })),
    // A plugin the manifest declares and no step uses. There are none today,
    // and the row that says so is the only place anyone would find out.
    { key: "unused", label: "declared, unused", plugins: setupInfo.plugins.filter((plugin) => plugin.phases.length === 0) },
  ].filter((group) => group.plugins.length > 0);

  return (
    <div className="overflow-hidden rounded-card border border-line shadow-xs">
      {groups.map((group) => (
        <section key={group.key} className="border-t border-line first:border-t-0">
          <h3 className="label flex items-center gap-2 bg-surface px-3 py-1.5">
            {group.label}
            <span className="text-muted/70">{group.plugins.length}</span>
          </h3>
          {group.plugins.map((plugin) => {
            const declared = setupInfo.steps.filter((step) => step.plugin === plugin.name);
            const runSteps = setupInfo.run?.steps.filter((step) => step.plugin === plugin.name) ?? [];
            const health = plugin.stepCount === 0 ? "unchecked" : healthFor(runSteps, declared.length, setupInfo);
            const outputs = [...new Set(runSteps.flatMap((step) => step.files))];
            // What the plugin says of itself, when it is one the package ships.
            // A plugin the manifest declares by its own `process` is not on the
            // index, and the row says nothing rather than something made up.
            const shipped = pluginByName(plugin.name);
            return (
              <details key={plugin.name} id={`plugin-${plugin.name}`} className="group scroll-mt-4 border-t border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-1.5 hover:bg-surface/60">
                  {health === "healthy" ? <HealthDot health={health} /> : null}
                  <PluginIcon icon={pluginIcon(plugin.name, shipped?.category)} className="text-muted" />
                  <span className="mono truncate text-ink" title={plugin.name}>{plugin.name}</span>
                  <Runtime plugin={plugin} icon />
                  {health === "healthy" ? null : <HealthBadge health={health} />}
                  <span className="mono ml-auto shrink-0 text-muted">
                    {plugin.projectIds.length > 0
                      ? `${plugin.projectIds.length} ${plural(plugin.projectIds.length, "project")}`
                      : plugin.stepCount > 0
                        ? "estate"
                        : "—"}
                  </span>
                  <ChevronDown size={15} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-line bg-surface/50 px-4 py-4">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)]">
                    <div>
                      <div className="label mb-2">last run</div>
                      <PipelineSteps steps={runSteps} />
                    </div>
                    <div className="space-y-4">
                      {shipped ? (
                        <div>
                          <div className="label mb-2">what it reads</div>
                          <p className="text-muted">{shipped.summary}</p>
                          <Link to={paths.plugin(plugin.name)} className="mono mt-1 inline-block text-accent hover:underline">
                            options and source →
                          </Link>
                        </div>
                      ) : null}
                      <div>
                        <div className="label mb-2">runtime</div>
                        <p className="mono"><Runtime plugin={plugin} /></p>
                      </div>
                      <div>
                        <div className="label mb-2">used by</div>
                        {plugin.projectIds.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.projectIds.map((id) => (
                              <Link key={id} to={`${paths.settingsProjects()}#project-${id}`} className="chip border-line-strong hover:border-accent hover:text-accent">
                                {projectNames.get(id) ?? id}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="mono text-muted">{plugin.stepCount > 0 ? "Estate-wide catalog" : "No pipeline step uses this plugin."}</p>
                        )}
                      </div>
                      {outputs.length > 0 ? (
                        <div>
                          <div className="label mb-2">outputs</div>
                          <ul className="mono space-y-1 text-muted">
                            {outputs.map((output) => <li key={output} className="truncate"><FileLink path={output} /></li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </details>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function PipelineSettings() {
  const setupInfo = useSetup();
  const active = setupInfo.plugins.filter((plugin) => plugin.stepCount > 0);
  return (
    <div className="space-y-section">
      <section>
        <SectionTitle right={`${active.length} of ${setupInfo.plugins.length} active`}>Plugins</SectionTitle>
        {active.length === 0 ? (
          <CapabilityEmpty
            title={setupInfo.projects.length === 0 ? "Connect a project to choose extractors" : "No extractors are active"}
            signal="Project detection selects extractors from the files and contracts it can prove are present."
            actions={
              <Link className="product-primary" to={paths.settingsProjects()}>
                {setupInfo.projects.length === 0 ? "Connect a project" : "Review projects"}
              </Link>
            }
          >
            {setupInfo.projects.length === 0
              ? "The pipeline is assembled from project evidence, so it starts after the first source is connected."
              : "The projects are configured, but no pipeline step currently reads them. Re-run project detection and review the proposed capabilities."
            }
          </CapabilityEmpty>
        ) : (
          <>
            <PluginsList />
            <p className="mono mt-2 text-muted">
              WASM runs without network or environment access, and a generator without a filesystem.
              A host process runs with the permissions of the build; a plugin in the host is Portolan's
              own code doing what needs a socket, such as fetching another repository. Every plugin the
              package ships, with what it reads and the options it takes, is on the <Link to={paths.plugins()} className="text-accent hover:underline">plugin reference</Link>.
            </p>
          </>
        )}
      </section>
      <details className="rounded-card border border-line shadow-xs">
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-ink">Advanced build inputs</summary>
        <div className="border-t border-line p-4">
          <div className="label mb-2">catalog source patterns</div>
          {setupInfo.sources.length === 0 ? (
            <Empty>no source patterns declared</Empty>
          ) : (
            <ul className="mono space-y-1 text-muted">
              {setupInfo.sources.map((source) => <li key={source}>{source}</li>)}
            </ul>
          )}
          <div className="label mt-5 mb-2">pipeline</div>
          {setupInfo.steps.length === 0 ? (
            <Empty>no pipeline steps declared</Empty>
          ) : (
            <div className="space-y-1">
              {setupInfo.steps.map((step, index) => (
                <div
                  key={`${step.phase}:${step.plugin}:${step.input ?? "catalog"}:${index}`}
                  className="mono grid gap-x-3 text-muted sm:grid-cols-[5rem_9rem_1fr]"
                >
                  <span>{step.phase}</span>
                  <span className="text-ink">{step.plugin}</span>
                  <span className="truncate" title={step.input ?? "merged catalog"}>{step.input ?? "merged catalog"} → {step.output}</span>
                </div>
              ))}
            </div>
          )}
          <div className="label mt-5 mb-2">generated documentation</div>
          <MachineDocs />
        </div>
      </details>
    </div>
  );
}
