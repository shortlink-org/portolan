import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import type { DiagramView } from "@likec4/core";
import { loadElk } from "../graph/elk";

/** Cubic segments with small rounded elbows, entirely inside the routed corridor. */
function roundedRoute(points: [number, number][]): [number, number][] {
  const result = [points[0]!];
  let current = points[0]!;
  const line = (end: [number, number]) => {
    result.push([current[0] + (end[0] - current[0]) / 3, current[1] + (end[1] - current[1]) / 3], [current[0] + (end[0] - current[0]) * 2 / 3, current[1] + (end[1] - current[1]) * 2 / 3], end);
    current = end;
  };
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const before = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const after = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (!before || !after) continue;
    const radius = Math.min(10, before / 2, after / 2);
    const incoming = [(b[0] - a[0]) / before, (b[1] - a[1]) / before];
    const outgoing = [(c[0] - b[0]) / after, (c[1] - b[1]) / after];
    const entry: [number, number] = [b[0] - incoming[0]! * radius, b[1] - incoming[1]! * radius];
    const exit: [number, number] = [b[0] + outgoing[0]! * radius, b[1] + outgoing[1]! * radius];
    line(entry);
    const k = radius * 0.55228475;
    result.push([entry[0] + incoming[0]! * k, entry[1] + incoming[1]! * k], [exit[0] - outgoing[0]! * k, exit[1] - outgoing[1]! * k], exit);
    current = exit;
  }
  line(points.at(-1)!);
  return result;
}

/** Preserve LikeC4's graph and node measurements; ELK supplies compound routing. */
export async function layoutContainers<T extends DiagramView>(view: T): Promise<T> {
  if (!view.nodes.length) return view;
  const byId = new Map(view.nodes.map((node) => [String(node.id), node]));
  const node = (id: string): ElkNode => {
    const source = byId.get(id)!;
    return {
      id,
      ...(source.children.length
        ? { children: source.children.map(node), layoutOptions: { "elk.padding": "[top=48,left=24,bottom=24,right=24]" } }
        : { width: source.width, height: source.height }),
    };
  };
  const result: ElkNode = await (await loadElk()).layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.mergeEdges": "false",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.nodeNode": "50",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: view.nodes.filter((source) => !source.parent).map((source) => node(source.id)),
    edges: view.edges.map((edge) => ({
      id: edge.id, sources: [edge.source], targets: [edge.target],
      ...(edge.labelBBox ? { labels: [{ text: edge.label ?? "", width: edge.labelBBox.width, height: edge.labelBBox.height }] } : {}),
    })),
  });
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const routes = new Map<string, { edge: ElkExtendedEdge; x: number; y: number }>();
  const walk = (parent: ElkNode, x = 0, y = 0) => {
    for (const edge of parent.edges ?? []) routes.set(edge.id, { edge, x, y });
    for (const child of parent.children ?? []) {
      const box = { x: x + (child.x ?? 0), y: y + (child.y ?? 0), width: child.width!, height: child.height! };
      positions.set(child.id, box);
      walk(child, box.x, box.y);
    }
  };
  walk(result);
  return {
    ...view,
    bounds: { x: 0, y: 0, width: result.width!, height: result.height! },
    nodes: view.nodes.map((source) => {
      const box = positions.get(source.id)!;
      return { ...source, ...box, labelBBox: { ...source.labelBBox, x: box.x + (source.children.length ? 16 : (box.width - source.labelBBox.width) / 2), y: box.y + (source.children.length ? 12 : (box.height - source.labelBBox.height) / 2) } };
    }),
    edges: view.edges.map((source) => {
      const route = routes.get(source.id);
      const section = route?.edge.sections?.[0];
      if (!route || !section || route.edge.sections?.length !== 1) throw new Error(`No single container route for ${source.id}`);
      // ELK returns edges on the root but their coordinates belong to their
      // `container`, which may be a deeply nested context.
      const origin = positions.get(route.edge.container ?? "") ?? route;
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => [point.x + origin.x, point.y + origin.y] as [number, number]);
      const label = route.edge.labels?.[0];
      return { ...source, points: roundedRoute(points), controlPoints: null, ...(label ? { labelBBox: { x: label.x! + origin.x, y: label.y! + origin.y, width: label.width!, height: label.height! }, isLabelCustomized: true } : {}) };
    }),
  } as T;
}
