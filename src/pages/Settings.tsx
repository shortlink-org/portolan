import { useDocumentTitle } from "../app/title";
import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { Box, Play } from "lucide-react";
import { useToastStore } from "../app/toast";
import { setupInfo as staticSetupInfo } from "../lib/setup-info";
import type { SetupInfo, SetupProject } from "../lib/setup-info";
import {
  removeProject as removeLocalProject,
  startGeneration,
  undoProjectRemoval,
} from "../lib/local-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { localKeys, localStatusQuery } from "../lib/queries";
import { paths } from "../routes";
import { SectionTitle } from "../components/PageHeader";
import { DeliverySettings } from "./settings/DeliverySettings";
import { RecordingSettings } from "./settings/RecordingSettings";
import { RulesSettings } from "./settings/RulesSettings";
import { RuleWorkbench } from "./settings/RuleWorkbench";
import { PreferencesSettings } from "./settings/PreferencesSettings";
import { AboutSettings } from "./settings/AboutSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";
import { SetupContext, useSetup } from "./settings/setup";
import type { ProjectSource } from "./settings/setup";
import { OverviewSettings } from "./settings/OverviewSettings";
import { ProjectsSettings } from "./settings/ProjectsSettings";
import { PipelineSettings } from "./settings/PipelineSettings";
import { Wizard } from "./settings/Wizard";
import { RunDialog } from "./settings/RunDialog";
import { RemoveProjectDialog } from "./settings/RemoveProjectDialog";

const SETTINGS_LINKS = [
  ["Overview", paths.settings()],
  ["Projects", paths.settingsProjects()],
  ["Pipeline", paths.settingsPipeline()],
  ["Delivery", paths.settingsDelivery()],
  ["Recordings", paths.settingsRecordings()],
  ["Rules", paths.settingsRules()],
  ["Integrations", paths.settingsIntegrations()],
  ["Preferences", paths.settingsPreferences()],
  ["About", paths.settingsAbout()],
] as const;

function RecordingsRoute({ local }: { local: boolean }) {
  const setupInfo = useSetup();
  return (
    <section>
      <SectionTitle right={local ? "reviewed before writing" : "local mode required"}>Recordings</SectionTitle>
      <RecordingSettings local={local} projects={setupInfo.projects} />
    </section>
  );
}

function SettingsNav() {
  return (
    <nav className="mt-5 border-b border-line" aria-label="Settings sections">
      <div className="tab-scroll flex overflow-x-auto">
        {SETTINGS_LINKS.map(([label, to], index) => (
          <NavLink
            key={to}
            to={to}
            end={index === 0}
            className={({ isActive }) =>
              `mono shrink-0 border-b-2 px-3 py-2 transition-colors ${
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function SettingsContent({ local, onAdd, onRemove, onGenerate }: { local: boolean; onAdd: (source: ProjectSource) => void; onRemove: (project: SetupProject) => void; onGenerate: () => void }) {
  const pathname = useLocation().pathname.replace(/\/$/, "");
  const overview = pathname === paths.settings();
  const about = pathname === paths.settingsAbout();
  const browserIntegration = pathname === paths.settingsIntegrations();
  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Settings</h1>
              {local ? <span className="chip status-verified">local mode</span> : null}
            </div>
            <p className="mt-1 max-w-prose text-muted">
              Configure projects, extraction, delivery automation, integrations and local preferences. {local ? "This local session can write reviewed changes." : "Build configuration is read-only here."}
            </p>
          </div>
          {local && !overview && !about && !browserIntegration ? (
            <button type="button" className="product-primary" onClick={onGenerate}>
              <Play size={15} /> Preview generated diff
            </button>
          ) : null}
        </div>
        <SettingsNav />
        <div className="mt-section">
          <Routes>
            <Route index element={<OverviewSettings local={local} onGenerate={onGenerate} />} />
            <Route path="projects" element={<ProjectsSettings local={local} onAdd={onAdd} onRemove={onRemove} />} />
            <Route path="pipeline" element={<PipelineSettings />} />
            <Route
              path="delivery"
              element={
                <section>
                  <SectionTitle right={local ? "preview before writing" : "local mode required"}>Delivery presets</SectionTitle>
                  <DeliverySettings local={local} />
                </section>
              }
            />
            <Route path="recordings" element={<RecordingsRoute local={local} />} />
            <Route path="rules" element={<RulesSettings local={local} />} />
            <Route path="rules/:id" element={<RuleWorkbench local={local} />} />
            <Route path="integrations" element={<IntegrationsSettings local={local} />} />
            <Route path="preferences" element={<PreferencesSettings />} />
            <Route path="about" element={<AboutSettings />} />
            <Route path="*" element={<Navigate to={paths.settings()} replace />} />
          </Routes>
        </div>
        {!about ? (
          <div className="mono mt-section flex items-center gap-2 pb-section text-muted">
            <Box size={14} aria-hidden />
            {browserIntegration
              ? "Task trackers use project configuration; Kafka UI, Confluence and Notion links stay in this browser."
              : local
                ? "Changes are written only after preview; generated files remain reviewable in git."
                : "Configuration is embedded at build time; changing it requires a new catalog build."}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Settings() {
  useDocumentTitle("Settings");
  const queryClient = useQueryClient();
  const status = useQuery(localStatusQuery());
  // No local server means no local mode; the static build-time setup stands in.
  const local = status.isSuccess;
  const setup = status.data?.setup ?? staticSetupInfo;
  const [wizardSource, setWizardSource] = useState<ProjectSource | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SetupProject | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const say = useToastStore((state) => state.say);
  const activeRunId = status.data?.activeRun?.id ?? null;
  useEffect(() => {
    if (!activeRunId) return;
    setRunId(activeRunId);
    setRunOpen(true);
  }, [activeRunId]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: localKeys.status });
  }, [queryClient]);
  // The wizard hands back the setup the server now has; keep the status in
  // step without a round trip.
  const setSetup = useCallback((next: SetupInfo) => {
    queryClient.setQueryData(localKeys.status, (current) => current ? { ...current, setup: next } : current);
  }, [queryClient]);
  async function generate(previewRunId?: string) {
    try {
      const run = await startGeneration(previewRunId ? "write" : "preview", previewRunId);
      setRunId(run.runId); setRunOpen(true);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      const result = await removeLocalProject(removeTarget.id);
      setSetup(result.setup);
      setRemoveTarget(null);
      say(`${result.project.name} removed from portolan.json.`, {
        label: "Undo",
        run: () => { void (async () => {
          try {
            const restored = await undoProjectRemoval(result.undoToken);
            setSetup(restored.setup);
            say(`${result.project.name} restored.`);
          } catch (cause) { say(cause instanceof Error ? cause.message : String(cause)); }
        })(); },
      });
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoveBusy(false);
    }
  }
  return (
    <SetupContext.Provider value={setup}>
      <SettingsContent local={local} onAdd={setWizardSource} onRemove={setRemoveTarget} onGenerate={() => void generate()} />
      <Wizard
        open={wizardSource !== null}
        initialSource={wizardSource ?? "local"}
        onClose={() => setWizardSource(null)}
        onAdded={setSetup}
        onRunStarted={(id) => { setRunId(id); setRunOpen(true); }}
      />
      <RemoveProjectDialog
        project={removeTarget}
        busy={removeBusy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void confirmRemove()}
      />
      <RunDialog runId={runId} open={runOpen} onClose={() => setRunOpen(false)} onFinished={refresh} onApply={(preview) => void generate(preview)} />
    </SetupContext.Provider>
  );
}
