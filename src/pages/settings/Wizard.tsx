import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Play, X } from "lucide-react";
import { useToastStore } from "../../app/toast";
import type { SetupInfo } from "../../lib/setup-info";
import {
  applyProjectTrial,
  cancelGeneration,
  discover,
  disposeProjectTrial,
  forgetRepositoryCredential,
  inspectRepository,
  LocalApiError,
  saveRepositoryCredential,
  startProjectTrial,
  subscribeToRun,
  undoProjectRemoval,
} from "../../lib/local-api";
import type { Discovery, ProjectDraft, ProjectPlan, RunEvent } from "../../lib/local-api";
import { Modal } from "../../components/Overlay";
import { groupDiagnostics } from "../../lib/warnings";
import { starterProject, useSetup } from "./setup";
import type { ProjectSource } from "./setup";
import { RepositoryFailure } from "./RepositoryFailure";
import { ConfigureStage, ScopeStage, SourceStage, TrialStage } from "./WizardStages";

const PROJECT_RESUME_KEY = "portolan.onboarding.project-source.v1";

function readProjectResume(): { source: ProjectSource; path: string; repository: string; ref: string; sourcePath: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_RESUME_KEY) ?? "null");
    return value && (value.source === "local" || value.source === "external") ? value : null;
  } catch { return null; }
}

export function Wizard({ open, initialSource, onClose, onAdded, onRunStarted }: { open: boolean; initialSource: ProjectSource; onClose: () => void; onAdded: (setup: SetupInfo) => void; onRunStarted: (runId: string) => void }) {
  const setupInfo = useSetup();
  const starter = starterProject(setupInfo);
  const say = useToastStore((state) => state.say);
  const [source, setSource] = useState<ProjectSource>(initialSource);
  const [stage, setStage] = useState<"source" | "scope" | "configure" | "trial">("source");
  const [path, setPath] = useState("");
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("main");
  const [sourcePath, setSourcePath] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scopeDiscovery, setScopeDiscovery] = useState<Discovery | null>(null);
  const [inspectionCommit, setInspectionCommit] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [pendingComponents, setPendingComponents] = useState<string[]>([]);
  const [batchPosition, setBatchPosition] = useState<{ current: number; total: number } | null>(null);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [trialRunId, setTrialRunId] = useState<string | null>(null);
  const [trialEvents, setTrialEvents] = useState<RunEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repositoryError, setRepositoryError] = useState<LocalApiError | null>(null);
  const [retryComponent, setRetryComponent] = useState<{ path: string; batch: boolean } | null>(null);
  const [credentialToken, setCredentialToken] = useState("");
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    if (open) {
      setSource(initialSource);
      const saved = readProjectResume();
      if (saved?.source === initialSource) {
        setPath(saved.path); setRepository(saved.repository); setRef(saved.ref); setSourcePath(saved.sourcePath); setResumed(true);
      }
      return;
    }
    if (!open) {
      setStage("source"); setSource("local"); setPath(""); setRepository(""); setRef("main"); setSourcePath("");
      setDiscovery(null); setScopeDiscovery(null); setInspectionCommit(""); setSelectedComponents([]); setPendingComponents([]); setBatchPosition(null);
      setDraft(null); setPlan(null); setTrialRunId(null); setTrialEvents([]);
      setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken(""); setResumed(false); setBusy(false);
    }
  }, [initialSource, open]);

  useEffect(() => {
    if (!open || (!path.trim() && !repository.trim())) return;
    try { localStorage.setItem(PROJECT_RESUME_KEY, JSON.stringify({ source, path, repository, ref, sourcePath })); } catch {}
  }, [open, path, ref, repository, source, sourcePath]);

  useEffect(() => {
    if (!trialRunId) return;
    return subscribeToRun(
      trialRunId,
      (event) => setTrialEvents((current) => [...current, event]),
      () => {},
    );
  }, [trialRunId]);

  function clearRepositoryFailure() {
    setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken("");
  }

  function selectSource(next: "local" | "external") {
    setSource(next);
    clearRepositoryFailure();
  }

  function startOver() {
    try { localStorage.removeItem(PROJECT_RESUME_KEY); } catch {}
    setSource(initialSource); setPath(""); setRepository(""); setRef("main"); setSourcePath(""); setResumed(false); clearRepositoryFailure();
  }

  async function detect() {
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    setScopeDiscovery(null);
    setSelectedComponents([]); setPendingComponents([]); setBatchPosition(null);
    try {
      const inspection = source === "external" ? await inspectRepository(repository, ref, sourcePath) : null;
      const found = inspection?.discovery ?? await discover(path);
      const commit = inspection?.commit ?? "";
      setInspectionCommit(commit);
      if (!sourcePath.trim() && found.components.some((component) => component.path !== ".")) {
        const onlyComponent = found.components.length === 1 ? found.components[0]?.path : undefined;
        setScopeDiscovery(found); setSelectedComponents(onlyComponent ? [onlyComponent] : []); setStage("scope");
      } else configure(found, commit, sourcePath);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setRepositoryError(cause instanceof LocalApiError && cause.code?.startsWith("repository_") ? cause : null); }
    finally { setBusy(false); }
  }

  function configure(found: Discovery, commit: string, selectedSourcePath: string, projectId?: string) {
    setDiscovery(found);
    const plugins = found.detections.filter((item) => item.selected).map((item) => item.plugin);
    const domainModel = plugins.some((plugin) => ["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain", "laravel-domain", "php-ddd"].includes(plugin));
    setDraft({
      source,
      root: found.root,
      repository,
      ref,
      commit,
      sourcePath: selectedSourcePath,
      ...found.defaults,
      ...(projectId ? { id: projectId } : {}),
      contextName: found.defaults.group
        ? found.defaults.group.replace(/(^|-)([a-z])/g, (_, gap, letter) => `${gap ? " " : ""}${letter.toUpperCase()}`)
        : "",
      contextSummary: "",
      classification: "supporting",
      groupKind: domainModel ? "bounded-context" : "system",
      componentKind: domainModel ? "service" : "application",
      replaceStarter: Boolean(starter),
      plugins,
    });
    setStage("configure");
  }

  async function chooseComponent(componentPath: string, batch = false) {
    if (!scopeDiscovery) return;
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    try {
      const projectId = batch && componentPath !== "." ? componentPath.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined;
      if (source === "external") {
        const selected = componentPath === "." ? "" : componentPath;
        const inspection = await inspectRepository(repository, inspectionCommit || ref, selected);
        configure(inspection.discovery, inspection.commit, selected, projectId);
      } else {
        const base = path.replace(/\/$/, "");
        const selected = componentPath === "." ? base : [base === "." ? "" : base, componentPath].filter(Boolean).join("/");
        configure(componentPath === "." ? scopeDiscovery : await discover(selected), "", "", projectId);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setRepositoryError(cause instanceof LocalApiError && cause.code?.startsWith("repository_") ? cause : null); setRetryComponent({ path: componentPath, batch }); }
    finally { setBusy(false); }
  }

  async function reviewSelectedComponents() {
    if (!scopeDiscovery || selectedComponents.length === 0) return;
    const ordered = scopeDiscovery.components.map((component) => component.path).filter((componentPath) => selectedComponents.includes(componentPath));
    const first = ordered[0];
    if (!first) return;
    setPendingComponents(ordered.slice(1));
    setBatchPosition(ordered.length > 1 ? { current: 1, total: ordered.length } : null);
    await chooseComponent(first, ordered.length > 1);
  }

  function retryInspection() {
    return retryComponent ? chooseComponent(retryComponent.path, retryComponent.batch) : detect();
  }

  async function authenticateRepository() {
    if (!credentialToken.trim()) return;
    setBusy(true);
    try {
      await saveRepositoryCredential(repository, credentialToken);
      setCredentialToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      return;
    }
    setBusy(false);
    await retryInspection();
  }

  async function forgetCredential() {
    if (!repositoryError) return;
    setBusy(true);
    try {
      await forgetRepositoryCredential(repository);
      setCredentialToken("");
      setRepositoryError(new LocalApiError(repositoryError.message, {
        status: repositoryError.status, code: repositoryError.code, retryable: repositoryError.retryable, provider: repositoryError.provider, host: repositoryError.host, credentialSupported: repositoryError.credentialSupported, credentialPresent: false,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function runTrial() {
    if (!draft) return;
    setBusy(true); setError("");
    setRepositoryError(null); setRetryComponent(null);
    try {
      const result = await startProjectTrial(draft);
      setPlan(result.plan); setTrialEvents([]); setTrialRunId(result.runId); setStage("trial");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function applyTrial(generate: boolean) {
    if (!trialRunId) return;
    setBusy(true); setError("");
    try {
      const result = await applyProjectTrial(trialRunId, generate);
      onAdded(result.setup);
      if (pendingComponents.length > 0) {
        const [next, ...remaining] = pendingComponents;
        if (!next) throw new Error("The next selected component is missing.");
        setPendingComponents(remaining); setBatchPosition((position) => position ? { ...position, current: position.current + 1 } : null);
        setTrialRunId(null); setTrialEvents([]); setPlan(null);
        await chooseComponent(next, true);
      } else {
        try { localStorage.removeItem(PROJECT_RESUME_KEY); } catch {}
        onClose();
        if (result.run) onRunStarted(result.run.runId);
        else say(`${result.project.name} added to portolan.json.`, {
          label: "Undo",
          run: () => { void (async () => {
            try {
              const restored = await undoProjectRemoval(result.undoToken);
              onAdded(restored.setup);
              say(`${result.project.name} addition undone.`);
            } catch (cause) { say(cause instanceof Error ? cause.message : String(cause)); }
          })(); },
        });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  }

  const finished = trialEvents.slice().reverse().find((event): event is Extract<RunEvent, { type: "process-finished" }> => event.type === "process-finished");
  const pipeline = trialEvents.find((event): event is Extract<RunEvent, { type: "pipeline-ready" }> => event.type === "pipeline-ready");
  const completedSteps = trialEvents.filter((event): event is Extract<RunEvent, { type: "step-finished" }> => event.type === "step-finished");
  const activeStep = trialEvents.slice().reverse().find((event): event is Extract<RunEvent, { type: "step-started" }> => event.type === "step-started");
  const trial = trialEvents.find((event): event is Extract<RunEvent, { type: "project-trial-ready" }> => event.type === "project-trial-ready");
  const logs = trialEvents.filter((event): event is Extract<RunEvent, { type: "log" }> => event.type === "log");
  const trialRunning = stage === "trial" && !finished;
  const confirmedDeployables = discovery?.deployables.filter((candidate) => candidate.confidence === "high") ?? [];
  const splitsDeployables = confirmedDeployables.length > 1 && draft?.component === discovery?.defaults.component;
  const trialDiagnostics = trial?.diagnostics ?? [];
  const trialActiveWarnings = trial
    ? groupDiagnostics(trialDiagnostics).filter((group) => !group.suppressed).reduce((sum, group) => sum + group.count, 0)
    : 0;
  const quality = trial && draft ? [
    { label: "Stable project identity", done: Boolean(draft.id.trim() && draft.name.trim()) },
    { label: "Architecture placement", done: Boolean(draft.group.trim() && (splitsDeployables || draft.component.trim())) },
    { label: "Catalog facts extracted", done: trial.facts.some((fact) => fact.count > 0) },
    { label: "Extraction without active warnings", done: trialActiveWarnings === 0 },
  ] : [];
  const totalSteps = pipeline?.stepCount ?? plan?.steps.length ?? 0;
  const percent = totalSteps ? Math.round((completedSteps.length / totalSteps) * 100) : 0;
  const heading = stage === "source" ? "Add a project" : stage === "scope" ? "Choose a component" : stage === "configure" ? "Place the project" : "Trial extraction";
  function back() {
    if (stage === "trial") { if (trialRunId) void disposeProjectTrial(trialRunId); setStage("configure"); setTrialRunId(null); setTrialEvents([]); setPlan(null); }
    else if (stage === "configure" && scopeDiscovery) { setStage("scope"); setPendingComponents([]); setBatchPosition(null); }
    else setStage("source");
    setError(""); setRepositoryError(null); setRetryComponent(null); setCredentialToken("");
  }
  return (
    <Modal open={open} onClose={busy || trialRunning ? () => {} : onClose} label={heading} width="min(800px,94vw)">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {stage !== "source" ? (
          <button type="button" className="tbtn p-1.5" onClick={back} disabled={trialRunning || busy} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{heading}</div>
          <div className="mono mt-0.5 text-muted">
            {stage === "source"
              ? "1 / 4 · source"
              : stage === "scope"
                ? "2 / 4 · scope"
                : stage === "configure"
                  ? `3 / 4 · identity & scope${batchPosition ? ` · ${batchPosition.current} / ${batchPosition.total}` : ""}`
                  : `4 / 4 · proof${batchPosition ? ` · ${batchPosition.current} / ${batchPosition.total}` : ""}`}
          </div>
        </div>
        <button type="button" className="tbtn p-1.5" onClick={onClose} disabled={busy || trialRunning} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {stage === "source" ? (
          <SourceStage
            repositoryError={repositoryError}
            repository={repository}
            gitRef={ref}
            sourcePath={sourcePath}
            path={path}
            source={source}
            resumed={resumed}
            clearRepositoryFailure={clearRepositoryFailure}
            startOver={startOver}
            selectSource={selectSource}
            setPath={setPath}
            setRepository={setRepository}
            setRef={setRef}
            setSourcePath={setSourcePath}
          />
        ) : stage === "scope" && scopeDiscovery ? (
          <ScopeStage
            scopeDiscovery={scopeDiscovery}
            selectedComponents={selectedComponents}
            setSelectedComponents={setSelectedComponents}
            busy={busy}
          />
        ) : stage === "configure" && discovery && draft ? (
          <ConfigureStage
            discovery={discovery}
            draft={draft}
            setDraft={setDraft}
            starter={starter}
            splitsDeployables={splitsDeployables}
            confirmedDeployables={confirmedDeployables}
          />
        ) : stage === "trial" && plan ? (
          <TrialStage
            plan={plan}
            trial={trial}
            finished={finished}
            activeStep={activeStep}
            completedSteps={completedSteps}
            logs={logs}
            percent={percent}
            totalSteps={totalSteps}
            quality={quality}
            trialDiagnostics={trialDiagnostics}
          />
        ) : null}
        {error ? (
          repositoryError ? (
            <RepositoryFailure
              failure={repositoryError}
              message={error}
              token={credentialToken}
              onTokenChange={setCredentialToken}
              onForget={() => void forgetCredential()}
              busy={busy}
            />
          ) : (
            <div role="alert" className="mt-4 rounded-control border border-unresolved px-3 py-2 text-unresolved">{error}</div>
          )
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" className="tbtn" onClick={onClose} disabled={busy || trialRunning}>Cancel</button>
        {stage === "source" ? (
          <button
            key={repositoryError?.retryable ? "retry-inspection" : source}
            type="button"
            className="product-primary"
            aria-label={repositoryError?.retryable ? credentialToken.trim() ? "Save token and retry" : "Retry inspection" : source === "external" ? "Inspect repository" : "Detect project"}
            onClick={() => void (repositoryError?.retryable ? credentialToken.trim() ? authenticateRepository() : retryInspection() : detect())}
            disabled={busy || (source === "local" ? !path.trim() : !repository.trim())}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}{" "}
            {repositoryError?.retryable
              ? credentialToken.trim() ? "Save token & retry" : "Retry inspection"
              : source === "external" ? "Inspect repository" : "Detect project"}
          </button>
        ) : null}
        {stage === "scope" ? (
          <button
            key={repositoryError?.retryable ? "retry-component" : "review-components"}
            type="button"
            className="product-primary"
            aria-label={repositoryError?.retryable ? credentialToken.trim() ? "Save token and retry" : "Retry inspection" : `Review ${selectedComponents.length || "selected"} ${selectedComponents.length === 1 ? "component" : "components"}`}
            onClick={() => void (repositoryError?.retryable ? credentialToken.trim() ? authenticateRepository() : retryInspection() : reviewSelectedComponents())}
            disabled={busy || (!repositoryError?.retryable && !selectedComponents.length)}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />}{" "}
            {repositoryError?.retryable
              ? credentialToken.trim() ? "Save token & retry" : "Retry inspection"
              : <>Review {selectedComponents.length || "selected"} {selectedComponents.length === 1 ? "component" : "components"}</>}
          </button>
        ) : null}
        {stage === "configure" ? (
          <button type="button" className="product-primary" onClick={() => void runTrial()} disabled={busy || !draft?.plugins.length}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Run trial extraction
          </button>
        ) : null}
        {stage === "trial" && trialRunning ? (
          <button type="button" className="tbtn" onClick={() => trialRunId && void cancelGeneration(trialRunId)}>Cancel trial</button>
        ) : null}
        {stage === "trial" && finished && !trial ? (
          <button type="button" className="product-primary" onClick={back}>Back to configuration</button>
        ) : null}
        {stage === "trial" && trial ? (
          pendingComponents.length > 0 ? (
            <button type="button" className="product-primary" onClick={() => void applyTrial(false)} disabled={busy}>
              {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Add & review next
            </button>
          ) : (
            <>
              <button type="button" className="tbtn" onClick={() => void applyTrial(false)} disabled={busy}>Add without generating</button>
              <button type="button" className="product-primary" onClick={() => void applyTrial(true)} disabled={busy}>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Add & generate
              </button>
            </>
          )
        ) : null}
      </div>
    </Modal>
  );
}
