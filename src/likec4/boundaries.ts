interface BoundaryNode {
  id: string;
  kind: string;
  parent?: string | null;
}

interface BoundaryEdge {
  id: string;
  source: string;
  target: string;
}

const OUTSIDE = new Set(["actor", "external", "unknown"]);

/**
 * Relations that cross a context boundary. A shared broker represents the
 * whole route, so both of its hops stay lit when it connects several contexts.
 */
export function boundaryEdgeIds(
  nodes: readonly BoundaryNode[],
  edges: readonly BoundaryEdge[],
  subject?: string,
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const contextOf = (id: string): string | null => {
    const seen = new Set<string>();
    let node = byId.get(id);
    while (node && !seen.has(node.id)) {
      if (node.kind === "context") return node.id;
      seen.add(node.id);
      node = node.parent ? byId.get(node.parent) : undefined;
    }
    return null;
  };
  const brokerContexts = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [brokerId, otherId] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
      if (byId.get(brokerId)?.kind !== "broker") continue;
      const context = contextOf(otherId);
      if (!context) continue;
      const contexts = brokerContexts.get(brokerId) ?? new Set<string>();
      contexts.add(context);
      brokerContexts.set(brokerId, contexts);
    }
  }

  return edges.flatMap((edge) => {
    const sourceContext = contextOf(edge.source);
    const targetContext = contextOf(edge.target);
    if (sourceContext && targetContext && sourceContext !== targetContext) {
      return !subject || sourceContext === subject || targetContext === subject ? [edge.id] : [];
    }
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const context = sourceContext ?? targetContext;
    const outside = OUTSIDE.has(source?.kind ?? "") || OUTSIDE.has(target?.kind ?? "");
    if (context && outside) return !subject || context === subject ? [edge.id] : [];

    const broker = source?.kind === "broker" ? source : target?.kind === "broker" ? target : null;
    if (!broker) return [];
    const contexts = brokerContexts.get(broker.id) ?? new Set<string>();
    const crosses = contexts.size > 1 && (!subject || contexts.has(subject));
    return crosses ? [edge.id] : [];
  });
}
