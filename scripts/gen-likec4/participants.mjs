// Who takes part besides the catalog's services - actors, brokers, stores,
// externals, the consumers nothing accounts for - and how a flow's lane is
// joined to the element it stands for.

import { safeId } from "./ids.mjs";

/** The participants that are not catalog services, and the references that name any participant. */
export function collectParticipants(g) {
  const { catalog, fqn } = g;
  // --- collect participants that are not catalog services --------------------
  const serviceIds = new Set(
    catalog.contexts.flatMap((c) => c.services.map((s) => s.id)),
  );
  const storeIds = new Set((catalog.stores ?? []).map((store) => store.id));
  const externalIds = new Set((catalog.externals ?? []).map((external) => external.id));
  const participantEntityRef = new Map();
  const rootParticipants = new Map(); // id -> kind
  for (const flow of catalog.flows) {
    for (const p of flow.participants) {
      if (p.entityRef) participantEntityRef.set(p.id, p.entityRef);
      // A nested Store cannot be an actor in a LikeC4 dynamic view. Keep its
      // readable root lane here; entityRef still powers UI links/backlinks.
      if (p.entityRef && (serviceIds.has(p.entityRef) || externalIds.has(p.entityRef))) continue;
      if (serviceIds.has(p.id)) continue;
      rootParticipants.set(p.id, { kind: p.kind, label: p.label ?? p.id });
    }
  }
  // A system outside the estate with a contract is a root participant whether or
  // not a flow has walked to it yet: a call recorded on `consumes` lands on it,
  // and the catalog knows what it is called, which a lane's bare id does not.
  for (const external of catalog.externals ?? []) {
    rootParticipants.set(external.id, {
      kind: "external",
      label: external.name || external.id,
    });
  }
  // Event consumers that no service accounts for are real dependencies too.
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            if (serviceIds.has(consumer.service)) continue;
            if (rootParticipants.has(consumer.service)) continue;
            rootParticipants.set(consumer.service, {
              kind: "unknown",
              label: consumer.service,
            });
          }
        }
      }
    }
  }

  // An unresolved call keeps the raw peer name, `risk.v1`, as its contract says;
  // the flow that made the same call put the peer on a lane whose id carries no
  // dot, `risk-v1`, because a dot would read as containment here. The two are
  // one participant, joined by the label the lane kept, so the call resolves to
  // the lane and not to a `v1` nested inside a `risk` that nobody declared.
  const participantByLabel = new Map();
  for (const [id, meta] of rootParticipants)
    participantByLabel.set(meta.label, id);
  // A dot means containment only for catalog services. Root participants are
  // declared as one safe identifier, so a broker named `river.orders` must be
  // referenced as `river_orders`, not as an undeclared `orders` inside `river`.
  const participantRef = (id) => {
    const entity = participantEntityRef.get(id) ?? id;
    if (storeIds.has(entity)) return safeId(id);
    if (externalIds.has(entity)) return safeId(entity);
    return rootParticipants.has(entity) && !serviceIds.has(entity) ? safeId(entity) : fqn(entity);
  };
  function peerParticipant(peer) {
    if (serviceIds.has(peer) || rootParticipants.has(peer)) return peer;
    return participantByLabel.get(peer);
  }

  // A store is a container the estate keeps its state in, so it belongs inside
  // the service that owns it — not at the model root, where a flow's own store
  // participants sit. The two are different ids and the catalog says nothing
  // that would join them, so neither is guessed into the other.
  const storesByOwner = new Map();
  const storeById = new Map();
  for (const store of catalog.stores ?? []) {
    storeById.set(store.id, store);
    const owned = storesByOwner.get(store.owner) ?? [];
    owned.push(store);
    storesByOwner.set(store.owner, owned);
  }
  return { serviceIds, storeIds, externalIds, participantEntityRef, rootParticipants, participantRef, peerParticipant, storesByOwner, storeById };
}

/** Every step of a flow, branches and loops included, in declaration order. */
export function walkFlowSteps(nodes, visit) {
  for (const node of nodes) {
    if (node.type === "step") visit(node);
    else if (node.type === "parallel")
      node.branches.forEach((b) => walkFlowSteps(b, visit));
    else if (node.type === "loop") walkFlowSteps(node.steps, visit);
    else if (node.type === "alt")
      node.branches.forEach((b) => walkFlowSteps(b.steps, visit));
  }
}
