interface Node { id: string; parent?: string | null }
interface Edge { id: string; source: string; target: string }

/** One hop only. Ancestors stay visible so a selected child is never dimmed by its frame. */
export function neighborhood(nodes: readonly Node[], edges: readonly Edge[], selected: string) {
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  if (!parents.has(selected)) return null;
  const inside = (id: string): boolean => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (id === selected) return true;
      seen.add(id);
      id = parents.get(id) ?? "";
    }
    return false;
  };
  const visible = new Set(nodes.filter((node) => inside(node.id)).map((node) => node.id));
  const activeEdges = edges.filter((edge) => visible.has(edge.source) || visible.has(edge.target));
  for (const edge of activeEdges) { visible.add(edge.source); visible.add(edge.target); }
  for (const node of [...visible]) {
    let parent = parents.get(node);
    while (parent && !visible.has(parent)) { visible.add(parent); parent = parents.get(parent); }
  }
  return { nodes: [...visible], edges: activeEdges.map((edge) => edge.id) };
}

const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Paint only: selection cannot move nodes, re-route edges, or trigger fitView. */
export function neighborhoodCss(focus: { nodes: string[]; edges: string[] }, edgeIds: readonly string[], selected: string) {
  const outside = (kind: string, ids: string[]) => `.react-flow__${kind}` + ids.map((id) => `:not([data-id="${quote(id)}"])`).join("");
  const labels = edgeIds.flatMap((id, i) => focus.edges.includes(id) ? [] : [`.react-flow__edgelabel-renderer > :nth-child(${i + 1})`]);
  return [
    `${outside("node", focus.nodes)} { opacity: .25; }`,
    `${outside("edge", focus.edges)} { opacity: .12; }`,
    `.react-flow__node[data-id="${quote(selected)}"] { outline: 2px solid var(--accent); outline-offset: 3px; }`,
    ...(labels.length ? [`${labels.join(", ")} { opacity: .08; }`] : []),
  ].join("\n");
}
