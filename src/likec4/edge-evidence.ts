export interface DiagramRelationEvidence {
  id: string;
  title: string;
  source: string;
  target: string;
  technology?: string;
  status?: string;
  detail?: string;
}

export interface DiagramEdgeEvidence {
  id: string;
  label: string;
  source: string;
  target: string;
  relations: DiagramRelationEvidence[];
}

interface EdgeLike {
  id: string;
  label?: string;
  source: string;
  target: string;
  relations?: readonly string[];
}

interface RelationLike {
  id: string;
  title?: string;
  source: { model: string };
  target: { model: string };
  technology?: string;
  color?: string;
  description?: string | { txt?: string };
}

export interface EvidenceModel {
  findView: (id: string) =>
    | { $layouted?: { edges: readonly EdgeLike[] } }
    | undefined;
  $data: { relations: Record<string, RelationLike | undefined> };
}

function descriptionText(value: RelationLike["description"]): string | undefined {
  if (typeof value === "string") return value;
  return value?.txt;
}

/** Exact generated relations folded into one rendered LikeC4 edge. */
export function evidenceForEdge(
  model: EvidenceModel,
  viewId: string,
  edgeId: string,
): DiagramEdgeEvidence | null {
  const edge = model.findView(viewId)?.$layouted?.edges.find(
    (candidate) => String(candidate.id) === edgeId,
  );
  if (!edge) return null;

  const relations = (edge.relations ?? []).flatMap((id) => {
    const relation = model.$data.relations[id];
    if (!relation) return [];
    return [{
      id,
      title: relation.title ?? edge.label ?? "Relationship",
      source: relation.source.model,
      target: relation.target.model,
      ...(relation.technology ? { technology: relation.technology } : {}),
      ...(relation.color ? { status: relation.color } : {}),
      ...(descriptionText(relation.description)
        ? { detail: descriptionText(relation.description) }
        : {}),
    }];
  });

  return {
    id: edgeId,
    label: edge.label ?? "Relationship",
    source: edge.source,
    target: edge.target,
    relations,
  };
}
