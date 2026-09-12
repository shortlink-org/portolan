// A recording uploaded from the page becomes a file beside the project and a
// verify step that reads it - nothing else. The pure half of that lives here,
// where a test can hold it: which step reads a project's recordings, where an
// upload lands, and what a trial run said about it once the verifier ran.
//
// The recording is kept in the repository on purpose (portolan.0014). The
// catalog is regenerated from files, by anyone, on any machine; a recording
// held anywhere else would verify a flow once and never again.

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const TRACE_PLUGIN = "otel";
export const RECORDINGS_DIR = "telemetry/recordings";
export const RECORDINGS_GLOB = `${RECORDINGS_DIR}/*.jsonl`;
export const UPLOAD_LIMIT = 32 * 1024 * 1024;

/** The verify step that reads a project's recordings, or null. */
export function traceStepFor(manifest, project) {
  const steps = (manifest.verify ?? []).map((step, index) => ({ step, index }));
  const mine = steps.filter(({ step }) => step.plugin === TRACE_PLUGIN && step.in === project.root);
  return mine[0] ?? null;
}

/**
 * The manifest with a step that reads the project's recordings: the one it
 * has, widened to the recordings directory when it does not look there yet,
 * or a new one after the last verify step. Says whether anything changed.
 */
export function manifestWithTraceStep(manifest, project) {
  const found = traceStepFor(manifest, project);
  const verify = [...(manifest.verify ?? [])];
  if (found) {
    const traces = found.step.options?.traces ?? [];
    if (traces.includes(RECORDINGS_GLOB)) return { manifest, changed: false, change: "none", step: found.step };
    const step = { ...found.step, options: { ...found.step.options, traces: [...traces, RECORDINGS_GLOB] } };
    verify[found.index] = step;
    return { manifest: { ...manifest, verify }, changed: true, change: "widened", step };
  }
  const step = {
    plugin: TRACE_PLUGIN,
    in: project.root,
    out: posix.join(project.root, "portolan"),
    options: { traces: [RECORDINGS_GLOB], out: "observed.json" },
  };
  verify.push(step);
  return { manifest: { ...manifest, verify }, changed: true, change: "added", step };
}

/** The step with the names the page was told to map, merged over what it had. */
export function stepWithMappings(step, { services, events, routes } = {}) {
  const options = { ...step.options };
  if (services && Object.keys(services).length) options.services = { ...options.services, ...services };
  if (events && Object.keys(events).length) options.events = { ...options.events, ...events };
  if (routes && Object.keys(routes).length) options.routes = { ...options.routes, ...routes };
  return { ...step, options };
}

/**
 * Where an upload lands, relative to the project root: dated, named after
 * the file it came as, and not on top of a recording already there.
 */
export function recordingPath(name, { today = new Date(), taken = () => false } = {}) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.(jsonl?|ndjson)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "recording";
  const date = today.toISOString().slice(0, 10);
  let candidate = `${RECORDINGS_DIR}/${date}-${stem}.jsonl`;
  for (let n = 2; taken(candidate); n += 1) candidate = `${RECORDINGS_DIR}/${date}-${stem}-${n}.jsonl`;
  return candidate;
}

/**
 * Says whether the bytes are a recording the verifier can read: OTLP JSON,
 * one batch per file or one per line, with resourceSpans in it.
 */
export function checkRecording(content) {
  const text = content.toString("utf8");
  if (!text.trim()) throw new Error("The recording is empty.");
  let batches = 0;
  let spans = 0;
  const read = (value) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.resourceSpans)) throw new Error("The recording is JSON, but not OTLP: no resourceSpans in it.");
    batches += 1;
    for (const rs of value.resourceSpans) for (const ss of rs?.scopeSpans ?? []) spans += (ss?.spans ?? []).length;
  };
  try {
    read(JSON.parse(text));
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let value;
        try { value = JSON.parse(line); } catch { throw new Error("The recording is not OTLP JSON: a collector's file exporter writes one batch per line."); }
        read(value);
      }
    } else {
      throw cause;
    }
  }
  if (!spans) throw new Error("The recording has no spans in it.");
  return { batches, spans };
}

/** What a verifier's warning is about, so the page can offer the mapping it asks for. */
export function readVerifyWarning(message) {
  let m = message.match(/spans from service\.name "([^"]+)" match no service/);
  if (m) return { kind: "service", name: m[1], message };
  m = message.match(/(?:publishes|consumes) "([^"]+)", which matches no event/);
  if (m) return { kind: "event", name: m[1], message };
  m = message.match(/answers on ([A-Z]* ?\S+), which no interface it provides declares/);
  if (m) return { kind: "route", name: m[1].trim(), message };
  m = message.match(/calls ([A-Z]+ \S+) on (\S+), which no service/);
  if (m) return { kind: "call", name: m[1], message };
  if (/but the catalog says it goes on/.test(message)) return { kind: "channel", message };
  return { kind: "other", message };
}

/**
 * What the trial run said about the recording: the flows the verifier wrote
 * with it, and the warnings that name something the page could map.
 */
export function summarizeTraceTrial(snapshot, trial, events) {
  const step = trial.step;
  const finished = events.find((event) => event.type === "step-finished" && event.phase === "verify" && event.plugin === step.plugin && event.output === step.out && (event.input ?? step.in) === step.in)
    ?? events.find((event) => event.type === "step-finished" && event.phase === "verify" && event.plugin === step.plugin && event.output === step.out);
  const warnings = (finished?.warnings ?? []).map(readVerifyWarning);
  const fragmentName = step.options?.out ?? "observed.json";
  let fragment = { flows: [] };
  try { fragment = JSON.parse(readFileSync(join(snapshot, step.out, fragmentName), "utf8")); } catch {}
  // An example names its recording relative to the repository, the way every
  // `source` in the catalog does; the upload was laid under the step's input.
  const recording = posix.join(step.in, trial.recording);
  const flows = [];
  for (const flow of fragment.flows ?? []) {
    const examples = (flow.examples ?? []).filter((example) => example.recording === recording);
    const steps = [];
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        if (node.type === "step") steps.push(node);
        else if (node.type === "alt") for (const branch of node.branches ?? []) walk(branch.steps);
        else if (node.type === "parallel") for (const branch of node.branches ?? []) walk(branch);
        else walk(node.steps);
      }
    };
    walk(flow.steps);
    const shown = new Set(examples.flatMap((example) => example.steps.map((s) => s.step)));
    const observed = String(flow.slug ?? "").startsWith("observed-");
    flows.push({
      id: flow.id,
      slug: flow.slug,
      name: flow.name,
      owner: flow.owner,
      kind: observed ? "observed" : "declared",
      inRecording: examples.length > 0,
      traces: examples.length,
      verified: steps.filter((s) => s.status === "verified").length,
      unresolved: steps.filter((s) => s.status === "unresolved").length,
      added: steps.filter((s) => s.seen && !observed && /^seen\d+$/.test(String(s.id))).length,
      shown: shown.size,
      steps: steps.length,
      examples: (flow.examples ?? []).length,
    });
  }
  flows.sort((a, b) => Number(b.inRecording) - Number(a.inRecording) || a.slug.localeCompare(b.slug));
  return {
    project: trial.projectId,
    recording: trial.recording,
    stepAdded: trial.stepAdded,
    stepChange: trial.stepChange ?? (trial.stepAdded ? "added" : "none"),
    status: finished?.status ?? "failed",
    spans: trial.spans,
    flows,
    warnings,
    mappings: { services: step.options?.services ?? {}, events: step.options?.events ?? {}, routes: step.options?.routes ?? {} },
  };
}
