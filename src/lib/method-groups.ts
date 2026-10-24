import type { RpcMethod } from "../catalog";

/**
 * A long HTTP interface is still one contract. These sections only make its
 * operations browsable; they do not add architecture facts to the catalog.
 */
export type MethodSection =
  | { kind: "group"; key: string; label: string; methods: RpcMethod[] }
  | { kind: "method"; method: RpcMethod };

export const HTTP_METHOD_GROUP_THRESHOLD = 20;

const TECHNICAL_SEGMENT = /^(api|v\d+)$/i;

/** The first route segment that says what the operation is about. */
function routeFamily(method: RpcMethod): string | null {
  if (!method.http) return null;

  return (
    method.http.path
      .split("/")
      .filter(Boolean)
      .find(
        (segment) =>
          !segment.startsWith("{") && !TECHNICAL_SEGMENT.test(segment),
      ) ?? null
  );
}

/**
 * Fold a large HTTP interface into repeated route families.
 *
 * Small interfaces stay exactly as authored. In a large one, a family earns
 * a disclosure only when at least two operations share it; one-off routes
 * remain ordinary rows. Both sections and methods retain source order.
 */
export function groupHttpMethods(
  methods: readonly RpcMethod[],
): MethodSection[] {
  const families = methods.map(routeFamily);
  const httpMethods = families.filter((family) => family !== null).length;

  if (httpMethods < HTTP_METHOD_GROUP_THRESHOLD) {
    return methods.map((method) => ({ kind: "method", method }));
  }

  const counts = new Map<string, number>();
  for (const family of families) {
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  const grouped = new Map<string, RpcMethod[]>();
  for (let index = 0; index < methods.length; index += 1) {
    const family = families[index];
    if (!family || (counts.get(family) ?? 0) < 2) continue;
    const members = grouped.get(family) ?? [];
    members.push(methods[index]!);
    grouped.set(family, members);
  }

  const emitted = new Set<string>();
  const sections: MethodSection[] = [];
  for (let index = 0; index < methods.length; index += 1) {
    const method = methods[index]!;
    const family = families[index];
    const members = family ? grouped.get(family) : undefined;

    if (!family || !members) {
      sections.push({ kind: "method", method });
      continue;
    }
    if (emitted.has(family)) continue;

    emitted.add(family);
    sections.push({
      kind: "group",
      key: family,
      label: `/${family}`,
      methods: members,
    });
  }

  return sections;
}
