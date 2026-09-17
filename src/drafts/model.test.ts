import { describe, expect, it } from "vitest";
import type { Event, Flow, FlowNode, Step } from "../catalog";
import { DRAFT_SCHEMA } from "../lib/branch-draft";
import type { BranchDraft } from "../lib/branch-draft";
import { branchFlow, removedStepId } from "./branch-flow";
import { eventLines, flowLines, presentDraft, taskCounts, taskOf, tasksOf } from "./model";
import type { Draft, DraftEntity, PresentContext } from "./model";

const step = (id: string, from: string, to: string, label: string, kind: Step["kind"] = "call"): Step => ({ type: "step", id, from, to, kind, label, status: "declared" });
const flow = (steps: FlowNode[], participants: Flow["participants"] = []): Flow => ({ id: "flow.login", slug: "login", name: "Login", summary: "", owner: "auth", participants, steps });
const event = (fields: [string, string][]): Event => ({
  id: "auth.auth.session.SessionStarted",
  slug: "session-started",
  name: "SessionStarted",
  versions: [{ version: "v1", doc: "", source: "", fields: fields.map(([name, type]) => ({ name, type, doc: "" })) }],
  consumers: [],
});

const base = flow([step("s1", "client", "auth.auth", "login"), step("s2", "auth.auth", "auth-pg", "ByEmail"), step("s3", "auth.auth", "bus", "SessionStarted")]);
const branch = flow([step("s1", "client", "auth.auth", "login"), step("s2", "auth.auth", "webauthn", "Verify"), step("s3", "auth.auth", "bus", "SessionStarted")]);

const context = (main: Map<string, unknown>): PresentContext => ({
  main,
  hrefOf: (kind, id) => `/${kind}/${id}`,
  contextOf: (serviceId) => serviceId.split(".")[0],
  knownParticipants: new Set(["client", "auth.auth", "auth-pg", "bus"]),
  projectName: "Authentication",
});

const draft = (entities: BranchDraft["entities"]): BranchDraft => ({ schema: DRAFT_SCHEMA, project: "auth", branch: "demo/x", tip: "1234567890", base: "abcdef1234", generatedAt: "2026-09-15T00:00:00Z", entities });

describe("change lines", () => {
  it("says what a branch did to a flow's steps, paired by what they do", () => {
    expect(flowLines(base, branch)).toEqual(["+ step auth.auth → webauthn: Verify", "- step auth.auth → auth-pg: ByEmail"]);
    expect(flowLines(undefined, branch)).toEqual(["+ 3 steps: client → auth.auth → webauthn → bus"]);
  });

  it("says what a branch did to an event's latest schema", () => {
    expect(eventLines(event([["userID", "string"], ["at", "time.Time"]]), event([["userID", "UserID"], ["method", "string"]]))).toEqual([
      "~ field userID string → UserID",
      "+ field method string",
      "- field at",
    ]);
  });
});

describe("presentDraft", () => {
  it("reads each entity against the main the site is built from", () => {
    const changed = { kind: "flow" as const, id: "flow.login", change: "changed" as const, base, branch };
    const onMain = presentDraft(draft([changed]), context(new Map([["flow:flow.login", base]])));
    expect(onMain.entities[0]).toMatchObject({ state: "changed", href: "/flow/flow.login", name: "Login" });
    expect(onMain).toMatchObject({ tip: "1234567", base: "abcdef1", health: { kind: "fresh" } });

    const mainMoved = flow([step("s1", "client", "auth.auth", "login"), step("s2", "auth.auth", "auth-pg", "ByEmailAndTenant"), step("s3", "auth.auth", "bus", "SessionStarted")]);
    const conflict = presentDraft(draft([changed]), context(new Map([["flow:flow.login", mainMoved]]))).entities[0]!;
    expect(conflict.state).toBe("conflict");
    expect(conflict.main).toEqual(["~ step s2 ByEmail → ByEmailAndTenant"]);
  });

  it("files a lane the branch's flow adds on the service that calls it", () => {
    const service = { kind: "service" as const, id: "auth.auth", change: "changed" as const, base: { id: "auth.auth", name: "Auth" }, branch: { id: "auth.auth", name: "Auth" } };
    const withLanes = flow(branch.steps, [
      { id: "client", kind: "actor", context: null },
      { id: "auth.auth", kind: "service", context: "auth" },
      { id: "webauthn", kind: "external", context: null },
      { id: "bus", kind: "broker", context: null },
    ]);
    const changed = { kind: "flow" as const, id: "flow.login", change: "changed" as const, base, branch: withLanes };
    const presented = presentDraft(draft([changed, service]), context(new Map<string, unknown>([["flow:flow.login", base], ["service:auth.auth", service.base]])));
    expect(presented.entities[1]!.newParticipants).toEqual([{ id: "webauthn", label: "webauthn", from: "auth.auth", via: "Verify" }]);
  });
});

describe("branchFlow", () => {
  it("lists the branch's steps with main's removed one where it stood, and marks both", () => {
    const entity = presentDraft(draft([{ kind: "flow", id: "flow.login", change: "changed", base, branch }]), context(new Map([["flow:flow.login", base]]))).entities[0]!;
    const shown = branchFlow(base, entity);
    expect(shown.flow.steps.map((node) => (node.type === "step" ? node.id : node.type))).toEqual(["s1", "s2", removedStepId("s2"), "s3"]);
    expect(shown.marks.get("s2")).toEqual({ state: "added" });
    expect(shown.marks.get(removedStepId("s2"))).toEqual({ state: "removed" });
    expect(shown.drawn).toBe(branch);
  });
});

describe("the task a branch belongs to", () => {
  it("is the tracker key its name carries, wherever the name carries it", () => {
    expect(taskOf("ASUP-976-refund-void-bridge")).toBe("ASUP-976");
    expect(taskOf("feature/ASUP-976")).toBe("ASUP-976");
    expect(taskOf("bugfix/AIR-12/retry")).toBe("AIR-12");
  });

  it("is the branch itself when the name carries no key a tracker would spell", () => {
    expect(taskOf("demo/auth-passkeys")).toBe("demo/auth-passkeys");
    expect(taskOf("renovate/ai-7.x")).toBe("renovate/ai-7.x");
    expect(taskOf("fix/retry-3")).toBe("fix/retry-3");
  });

  it("groups the drafts of one ticket across projects and adds up what they did", () => {
    const of = (project: string, branch: string, state: DraftEntity["state"]): Draft =>
      ({ project, branch, projectName: project, tip: "a", base: "b", savedAt: "", health: { kind: "fresh" }, views: {}, elements: {},
        entities: [{ id: `${project}.x`, kind: "service", name: "x", state, owner: project, branch: [], versions: {} }] }) as Draft;
    const tasks = tasksOf([
      of("aviacore", "ASUP-976-refund-void-bridge", "changed"),
      of("avia-api-bridge", "ASUP-976-refund-void-bridge", "conflict"),
      of("aviasupp", "ASUP-995-websky", "added"),
    ]);
    expect(tasks.map((task) => [task.key, task.drafts.length])).toEqual([["ASUP-976", 2], ["ASUP-995", 1]]);
    expect(tasks[0]!.branches).toEqual(["ASUP-976-refund-void-bridge"]);
    expect(taskCounts(tasks[0]!)).toEqual({ added: 0, changed: 1, grown: 0, conflict: 1, removed: 0 });
  });
});
