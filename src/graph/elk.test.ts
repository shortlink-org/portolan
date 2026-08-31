import { describe, expect, it } from "vitest";
import { layoutWithElk } from "./elk";

describe("layoutWithElk", () => {
  it("places every node and reports a canvas that contains them", async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      width: 160,
      height: 32,
    }));
    const edges = [
      { id: "e0", source: "n0", target: "n1" },
      { id: "e1", source: "n0", target: "n2" },
      { id: "e2", source: "n1", target: "n3" },
      { id: "e3", source: "n2", target: "n3" },
      { id: "e4", source: "n3", target: "n4" },
      { id: "e5", source: "n4", target: "n5" },
    ];
    const result = await layoutWithElk({ nodes, edges });

    for (const node of nodes) {
      const pos = result.positions[node.id];
      expect(pos, node.id).toBeDefined();
      if (!pos) continue;
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.x + node.width).toBeLessThanOrEqual(result.width + 1);
      expect(pos.y + node.height).toBeLessThanOrEqual(result.height + 1);
    }
  });

  it("never overlaps two boxes", async () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      width: 160,
      height: 32,
    }));
    const edges = nodes.slice(1).map((n, i) => ({
      id: `e${i}`,
      source: "n0",
      target: n.id,
    }));
    const { positions } = await layoutWithElk({ nodes, edges });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b) continue;
        const pa = positions[a.id];
        const pb = positions[b.id];
        if (!pa || !pb) continue;
        const overlap =
          pa.x < pb.x + b.width &&
          pb.x < pa.x + a.width &&
          pa.y < pb.y + b.height &&
          pb.y < pa.y + a.height;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("lays a single node out without edges", async () => {
    const result = await layoutWithElk({
      nodes: [{ id: "only", width: 100, height: 20 }],
      edges: [],
    });
    expect(result.positions["only"]).toBeDefined();
  });
});
