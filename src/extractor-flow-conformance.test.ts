// One flow contract over every checked-in extractor golden, independent of
// implementation language. Individual extractor tests prove how facts were
// read; this suite proves their JSON means the same thing once it reaches the
// host.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface RawNode {
  type: "step" | "alt" | "parallel" | "loop";
  id: string;
  from?: string;
  to?: string;
  kind?: string;
  status?: string;
  replyTo?: string;
  branches?: Array<RawNode[] | { steps: RawNode[] }>;
  steps?: RawNode[];
}

interface RawFlow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  owner: string;
  trigger?: { kind: string; confidence: string };
  participants: Array<{ id: string; kind: string; context: string | null; entityRef?: string }>;
  steps: RawNode[];
}

function nodesOf(nodes: RawNode[]): RawNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "step") return [node];
    if (node.type === "loop") return nodesOf(node.steps ?? []);
    return (node.branches ?? []).flatMap((branch) =>
      nodesOf(Array.isArray(branch) ? branch : branch.steps),
    );
  });
}

const expected = readdirSync("plugins", { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith("expected.json"))
  .map((name) => join("plugins", name));

const fixtures = expected.flatMap((file) => {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { flows?: RawFlow[] };
  return (parsed.flows ?? []).map((flow) => ({ file, flow }));
});

describe("extractor flow conformance", () => {
  it("discovers flow goldens from every implementation language", () => {
    const plugins = new Set(fixtures.map(({ file }) => file.split("/")[1]));
    expect([...plugins].sort()).toEqual([
      "extract-celery",
      "extract-csharp-ddd",
      "extract-django",
      "extract-java",
      "extract-laravel",
      "extract-php-ddd",
      "extract-rust",
      "extract-ts",
      "extract-watermill",
    ]);
  });

  it.each(fixtures)("$file: $flow.slug obeys the shared flow contract", ({ flow }) => {
    expect(flow.id).toBeTruthy();
    expect(flow.slug).toBeTruthy();
    expect(flow.name).toBeTruthy();
    expect(typeof flow.summary).toBe("string");
    expect(flow.owner).toBeTruthy();

    const lanes = flow.participants.map((participant) => participant.id);
    expect(new Set(lanes).size).toBe(lanes.length);
    const steps = nodesOf(flow.steps);
    const ids = steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of steps) {
      expect(lanes).toContain(step.from);
      expect(lanes).toContain(step.to);
      expect(["rpc", "event", "call", "response"]).toContain(step.kind);
      expect(["verified", "declared", "unresolved"]).toContain(step.status);
      if (step.replyTo) expect(ids).toContain(step.replyTo);
    }
    if (flow.trigger) {
      expect(["high", "medium", "low"]).toContain(flow.trigger.confidence);
    }
  });
});
