import { describe, expect, it } from "vitest";
import { LikeC4 } from "likec4";
import { layoutContainers } from "./container-layout";

describe("container routing", () => {
  it("preserves every relation and routes nested edges in absolute canvas coordinates", async () => {
    const engine = await LikeC4.fromSource(`
      specification { element context element service element store element broker }
      model {
        client = service 'Client'
        shop = context 'Shop' {
          api = service 'Shopping cart'
          db = store 'Cart database'
          api -> db 'owns'
        }
        payments = context 'Payments' { api = service 'Ledger' }
        bus = broker 'Bus'
        client -> shop.api 'HTTP'
        shop.api -> payments.api 'gRPC'
        shop.api -> bus 'publish'
        bus -> shop.api 'consume'
        payments.api -> bus 'publish'
      }
      views { view containers { include client, shop, shop.*, payments, payments.*, bus } }
    `, { logger: false });
    try {
      const viewId = (await engine.computedModel()).view("containers").$view.id;
      const source = (await engine.viewsService.layoutView({ viewId }))!.diagram;
      const snapshot = JSON.stringify(source);
      const result = await layoutContainers(source);
      expect(JSON.stringify(source)).toBe(snapshot);
      expect(result.nodes.map((node) => node.id)).toEqual(source.nodes.map((node) => node.id));
      expect(result.edges.map((edge) => [edge.id, edge.relations, edge.source, edge.target])).toEqual(source.edges.map((edge) => [edge.id, edge.relations, edge.source, edge.target]));
      const byId = new Map(result.nodes.map((node) => [node.id, node]));
      for (const node of result.nodes) {
        const parent = node.parent ? byId.get(node.parent)! : result.bounds;
        expect(node.x).toBeGreaterThanOrEqual(parent.x);
        expect(node.y).toBeGreaterThanOrEqual(parent.y);
        expect(node.x + node.width).toBeLessThanOrEqual(parent.x + parent.width);
        expect(node.y + node.height).toBeLessThanOrEqual(parent.y + parent.height);
      }
      for (const edge of result.edges) {
        expect((edge.points.length - 1) % 3).toBe(0);
        for (const [point, id] of [[edge.points[0]!, edge.source], [edge.points.at(-1)!, edge.target]] as const) {
          const node = byId.get(id)!;
          const distanceToBorder = Math.min(Math.abs(point[0] - node.x), Math.abs(point[0] - node.x - node.width), Math.abs(point[1] - node.y), Math.abs(point[1] - node.y - node.height));
          expect(distanceToBorder).toBeLessThan(0.01);
          expect(point[0]).toBeGreaterThanOrEqual(node.x - .01);
          expect(point[0]).toBeLessThanOrEqual(node.x + node.width + .01);
          expect(point[1]).toBeGreaterThanOrEqual(node.y - .01);
          expect(point[1]).toBeLessThanOrEqual(node.y + node.height + .01);
        }
        if (edge.parent && edge.labelBBox) {
          const parent = byId.get(edge.parent)!;
          expect(edge.labelBBox.x).toBeGreaterThanOrEqual(parent.x);
          expect(edge.labelBBox.y).toBeGreaterThanOrEqual(parent.y);
        }
      }
    } finally { await engine.dispose(); }
  });
});
