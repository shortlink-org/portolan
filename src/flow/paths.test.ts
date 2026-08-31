import { describe, expect, it } from "vitest";
import raw from "../../data/catalog.json";
import type { Alt, Catalog, Flow, FlowNode } from "../catalog";
import { stepFrames, walkSteps } from "../catalog";
import { flowPaths } from "./paths";

const catalog = raw as unknown as Catalog;
const checkout = catalog.flows.find((f) => f.slug === "checkout") as Flow;

const ids = (flow: Flow): string[] => walkSteps(flow.steps).map((s) => s.id);

/** Every Alt in a flow, at any depth. */
function alts(nodes: FlowNode[], out: Alt[] = []): Alt[] {
  for (const node of nodes) {
    switch (node.type) {
      case "step":
        break;
      case "alt":
        out.push(node);
        for (const b of node.branches) alts(b.steps, out);
        break;
      case "parallel":
        for (const b of node.branches) alts(b, out);
        break;
      case "loop":
        alts(node.steps, out);
        break;
    }
  }
  return out;
}

describe("flowPaths", () => {
  it("gives a flow with no alt exactly one path, with no choices", () => {
    const flat = catalog.flows.filter((f) => alts(f.steps).length === 0);
    expect(flat.length).toBeGreaterThan(0);
    for (const flow of flat) {
      const { paths, truncated } = flowPaths(flow);
      expect(truncated, flow.slug).toBe(false);
      expect(paths, flow.slug).toHaveLength(1);
      expect(paths[0]?.choices, flow.slug).toEqual([]);
      expect(paths[0]?.terminal, flow.slug).toBe(false);
      expect([...(paths[0]?.stepIds ?? [])], flow.slug).toEqual(ids(flow));
    }
  });

  it("forks checkout once per branch of every alt it reaches", () => {
    const { paths, truncated } = flowPaths(checkout);
    expect(truncated).toBe(false);
    // Five alts down the sequence — quote, risk, currency, authorization,
    // capture — three of which carry a branch that ends the flow. A terminal
    // branch takes no further choices, which is what keeps this from being 72.
    expect(alts(checkout.steps).map((a) => a.branches.length)).toEqual([
      2, 3, 3, 2, 2,
    ]);
    expect(paths).toHaveLength(30);
    expect(new Set(paths.map((p) => p.id)).size).toBe(paths.length);
  });

  it("never puts two branches of the same alt on one path", () => {
    for (const flow of catalog.flows) {
      const frames = stepFrames(flow.steps);
      for (const path of flowPaths(flow).paths) {
        const chosen = new Map<string, string>();
        for (const id of path.stepIds) {
          for (const frame of frames.get(id) ?? []) {
            if (frame.kind !== "alt") continue;
            const seen = chosen.get(frame.id);
            if (seen === undefined) chosen.set(frame.id, frame.branch ?? "");
            else expect(seen, `${flow.slug} ${path.id}`).toBe(frame.branch);
          }
        }
      }
    }
  });

  it("stops a terminal path at the branch that ends it", () => {
    for (const flow of catalog.flows) {
      const order = ids(flow);
      const frames = stepFrames(flow.steps);
      for (const path of flowPaths(flow).paths) {
        const ending = path.choices.find((c) => c.terminal);
        expect(path.terminal, `${flow.slug} ${path.id}`).toBe(
          ending !== undefined,
        );
        if (!ending) continue;
        // Nothing outside the branch that ended it may survive past it.
        const last = order.filter((id) => path.stepIds.has(id)).at(-1);
        expect(
          (frames.get(last ?? "") ?? []).some(
            (f) => f.kind === "alt" && f.id === ending.altId,
          ),
          `${flow.slug} ${path.id}`,
        ).toBe(true);
      }
    }
  });

  it("covers every step of the flow across all of its paths", () => {
    for (const flow of catalog.flows) {
      const union = new Set<string>();
      for (const path of flowPaths(flow).paths) {
        for (const id of path.stepIds) union.add(id);
      }
      expect([...union].sort(), flow.slug).toEqual([...ids(flow)].sort());
    }
  });

  it("keeps every path a subsequence of the flow's own step order", () => {
    for (const flow of catalog.flows) {
      const order = ids(flow);
      for (const path of flowPaths(flow).paths) {
        const onPath = order.filter((id) => path.stepIds.has(id));
        expect([...path.stepIds], `${flow.slug} ${path.id}`).toEqual(onPath);
      }
    }
  });

  it("names a path by the conditions it took, in order", () => {
    for (const path of flowPaths(checkout).paths) {
      expect(path.label).toBe(path.choices.map((c) => c.title).join(" · "));
      expect(path.choices.map((c) => c.altId)).toEqual(
        alts(checkout.steps)
          .map((a) => a.id)
          .filter((id) => path.choices.some((c) => c.altId === id)),
      );
    }
  });
});
