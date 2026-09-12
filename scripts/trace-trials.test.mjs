import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkRecording, manifestWithTraceStep, readVerifyWarning, recordingPath, stepWithMappings, summarizeTraceTrial, traceStepFor } from "./trace-trials.mjs";

const project = { id: "auth", name: "Auth", root: "examples/auth", context: "auth", service: "auth" };

describe("the step that reads a project's recordings", () => {
  it("is added after the last verify step when the project has none", () => {
    const manifest = { sources: ["x/*.json"], projects: [project], verify: [{ plugin: "codeowners", in: ".github", out: "data" }] };
    const next = manifestWithTraceStep(manifest, project);

    expect(next.changed).toBe(true);
    expect(next.change).toBe("added");
    expect(next.manifest.verify).toHaveLength(2);
    expect(next.step).toEqual({ plugin: "otel", in: "examples/auth", out: "examples/auth/portolan", options: { traces: ["telemetry/recordings/*.jsonl"], out: "observed.json" } });
    expect(manifest.verify).toHaveLength(1);
  });

  it("is widened to the recordings directory when it reads elsewhere, and left alone when it already does", () => {
    const step = { plugin: "otel", in: "examples/auth", out: "examples/auth/portolan", options: { traces: ["telemetry/traces.jsonl"], out: "observed.json", services: { "auth-api": "auth.auth" } } };
    const manifest = { sources: [], projects: [project], verify: [step] };

    const widened = manifestWithTraceStep(manifest, project);
    expect(widened.changed).toBe(true);
    expect(widened.change).toBe("widened");
    expect(widened.step.options.traces).toEqual(["telemetry/traces.jsonl", "telemetry/recordings/*.jsonl"]);
    expect(widened.step.options.services).toEqual({ "auth-api": "auth.auth" });

    const again = manifestWithTraceStep(widened.manifest, project);
    expect(again.changed).toBe(false);
    expect(again.change).toBe("none");
    expect(traceStepFor(again.manifest, project)?.index).toBe(0);
  });

  it("is the project's own, not another project's", () => {
    const other = { plugin: "otel", in: "examples/shop/cart", out: "examples/shop/cart/portolan", options: { traces: ["telemetry/traces.jsonl"] } };
    expect(traceStepFor({ verify: [other] }, project)).toBeNull();
  });

  it("takes the names the page mapped over what it had", () => {
    const step = { plugin: "otel", in: "x", out: "y", options: { traces: ["a"], events: { "a.B": "x.y.B" } } };
    const mapped = stepWithMappings(step, { services: { "auth-api": "auth.auth" }, events: { "a.C": "x.y.C" } });
    expect(mapped.options).toEqual({ traces: ["a"], events: { "a.B": "x.y.B", "a.C": "x.y.C" }, services: { "auth-api": "auth.auth" } });
    expect(stepWithMappings(step, {})).toEqual(step);
  });
});

describe("where an upload lands", () => {
  const today = new Date("2026-09-12T10:00:00Z");

  it("is dated, named after the file, and never on top of another", () => {
    expect(recordingPath("Login Traces.JSONL", { today })).toBe("telemetry/recordings/2026-09-12-login-traces.jsonl");
    expect(recordingPath("/tmp/export/traces.json", { today })).toBe("telemetry/recordings/2026-09-12-traces.jsonl");
    expect(recordingPath("", { today })).toBe("telemetry/recordings/2026-09-12-recording.jsonl");
    const taken = new Set(["telemetry/recordings/2026-09-12-traces.jsonl", "telemetry/recordings/2026-09-12-traces-2.jsonl"]);
    expect(recordingPath("traces.jsonl", { today, taken: (candidate) => taken.has(candidate) })).toBe("telemetry/recordings/2026-09-12-traces-3.jsonl");
  });
});

describe("what an upload has to be", () => {
  const batch = (spans) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ spans }] }] });
  const span = { traceId: "t", spanId: "s", name: "GET /", kind: 2 };

  it("reads one value or one per line", () => {
    expect(checkRecording(Buffer.from(batch([span])))).toEqual({ batches: 1, spans: 1 });
    expect(checkRecording(Buffer.from(`${batch([span])}\n${batch([span, span])}\n`))).toEqual({ batches: 2, spans: 3 });
  });

  it("refuses what the verifier could not read, and says why", () => {
    expect(() => checkRecording(Buffer.from(""))).toThrow(/empty/);
    expect(() => checkRecording(Buffer.from("not json"))).toThrow(/not OTLP JSON/);
    expect(() => checkRecording(Buffer.from('{"traces":[]}'))).toThrow(/no resourceSpans/);
    expect(() => checkRecording(Buffer.from(batch([])))).toThrow(/no spans/);
  });
});

describe("what a verifier's warning is about", () => {
  it("names the service, event or route the page could map", () => {
    expect(readVerifyWarning('spans from service.name "auth-api" match no service in the catalog; name it under `services` to say which one it is')).toMatchObject({ kind: "service", name: "auth-api" });
    expect(readVerifyWarning('publishes "auth.Ended", which matches no event of its own in the catalog; name it under `events`')).toMatchObject({ kind: "event", name: "auth.Ended" });
    expect(readVerifyWarning('consumes "auth.Ended", which matches no event in the catalog; name it under `events`')).toMatchObject({ kind: "event", name: "auth.Ended" });
    expect(readVerifyWarning("answers on GET /v1/health, which no interface it provides declares; the flow opens on the route rather than an operation")).toMatchObject({ kind: "route", name: "GET /v1/health" });
    expect(readVerifyWarning("calls GET /v1/profiles/42 on profile, which no service in the catalog answers on; the hop is unresolved")).toMatchObject({ kind: "call", name: "GET /v1/profiles/42" });
    expect(readVerifyWarning('publishes "a" on "x", but the catalog says it goes on "y"')).toMatchObject({ kind: "channel" });
    expect(readVerifyWarning("something else")).toEqual({ kind: "other", message: "something else" });
  });
});

describe("what a trial run said about the recording", () => {
  const roots = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("lists the flows the recording showed first, with what it raised and added", () => {
    const snapshot = mkdtempSync(join(tmpdir(), "portolan-trace-trial-"));
    roots.push(snapshot);
    mkdirSync(join(snapshot, "examples/auth/portolan"), { recursive: true });
    const recording = "telemetry/recordings/2026-09-12-login.jsonl";
    const named = `examples/auth/${recording}`;
    writeFileSync(join(snapshot, "examples/auth/portolan/observed.json"), JSON.stringify({
      flows: [
        {
          id: "flow.auth-login", slug: "auth-login", name: "Login", owner: "auth", participants: [],
          steps: [
            { type: "step", id: "s1", status: "verified", seen: { traces: 1 } },
            { type: "step", id: "s2", status: "declared" },
            { type: "alt", id: "alt3", branches: [{ title: "blocked", steps: [{ type: "step", id: "seen1", status: "unresolved", seen: { traces: 1 } }] }] },
          ],
          examples: [{ id: `${recording}#t1`, recording: named, traceId: "t1", durationMs: 1, steps: [{ step: "s1", durationMs: 1 }, { step: "seen1", durationMs: 1 }] }],
        },
        {
          id: "flow.observed-auth-get-v1-health", slug: "observed-auth-get-v1-health", name: "Observed: GET /v1/health", owner: "auth", participants: [],
          steps: [{ type: "step", id: "s1", status: "verified", seen: { traces: 3 } }],
          examples: [{ id: "telemetry/traces.jsonl#t9", recording: "examples/auth/telemetry/traces.jsonl", traceId: "t9", durationMs: 1, steps: [] }],
        },
      ],
    }));
    const step = { plugin: "otel", in: "examples/auth", out: "examples/auth/portolan", options: { traces: ["telemetry/recordings/*.jsonl"], out: "observed.json", services: { "auth-api": "auth.auth" } } };
    const events = [
      { type: "step-finished", phase: "extract", plugin: "go-domain", output: "examples/auth/portolan", status: "ok", warnings: ["ignored"] },
      { type: "step-finished", phase: "verify", plugin: "otel", input: "examples/auth", output: "examples/auth/portolan", status: "warning", warnings: ['spans from service.name "risk" match no service in the catalog; name it under `services` to say which one it is'] },
    ];

    const summary = summarizeTraceTrial(snapshot, { projectId: "auth", root: "examples/auth", recording, step, stepAdded: true, stepChange: "widened", spans: 7 }, events);

    expect(summary).toMatchObject({ project: "auth", recording, stepAdded: true, stepChange: "widened", status: "warning", spans: 7, mappings: { services: { "auth-api": "auth.auth" }, events: {} } });
    expect(summary.warnings).toEqual([{ kind: "service", name: "risk", message: events[1].warnings[0] }]);
    expect(summary.flows.map((flow) => flow.slug)).toEqual(["auth-login", "observed-auth-get-v1-health"]);
    expect(summary.flows[0]).toMatchObject({ kind: "declared", inRecording: true, traces: 1, verified: 1, unresolved: 1, added: 1, shown: 2, steps: 3, examples: 1 });
    expect(summary.flows[1]).toMatchObject({ kind: "observed", inRecording: false, traces: 0, verified: 1, added: 0 });
  });

  it("is a failed, empty summary when the verifier wrote nothing", () => {
    const snapshot = mkdtempSync(join(tmpdir(), "portolan-trace-trial-"));
    roots.push(snapshot);
    const step = { plugin: "otel", in: "x", out: "x/portolan", options: { traces: [] } };
    const summary = summarizeTraceTrial(snapshot, { projectId: "p", root: "x", recording: "telemetry/recordings/a.jsonl", step, stepAdded: false, spans: 1 }, []);
    expect(summary).toMatchObject({ status: "failed", flows: [], warnings: [] });
  });
});
