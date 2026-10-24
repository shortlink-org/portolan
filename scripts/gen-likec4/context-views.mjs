// One context's pictures: its containers at level 2, and for each service
// its neighbours and, at level 3, what is inside it.

import { contextLandscapeViewId, contextViewId, filterVariants, q, safeId, serviceInsideViewId, serviceViewId } from "./ids.mjs";

/** The level-2 view of each context, and the two views of each of its services. */
export function contextViews(g) {
  const { catalog, fqn, views, storesByOwner, storeById, persists, callPairs, carriedByBus, containerPredicates, containerCards, contextLabels, neighbourLabels, crossings, landscapeLabels, brokerIds, rootParticipants, OUTSIDE } = g;
  for (const context of catalog.contexts) {
    // --- C4 level 1: this context and only the roots it actually touches -----
    // Keep the subject closed. The next level opens exactly the same context;
    // this view answers who is across its boundary before showing internals.
    const home = safeId(context.id);
    const neighbours = [];
    const seen = new Set([home]);
    for (const crossing of crossings) {
      const from = crossing.from.split(".")[0];
      const to = crossing.to.split(".")[0];
      if (from === to || (from !== home && to !== home)) continue;
      const other = from === home ? to : from;
      if (!seen.has(other)) { seen.add(other); neighbours.push(other); }
    }
    const roots = [home, ...neighbours];
    views.push(`  view ${contextLandscapeViewId(context)} {`);
    views.push(`    title ${q(`${context.name} — context`)}`);
    views.push(`    description ${q(`${context.name}, and every context or outside system connected to it.`)}`);
    views.push(`    include ${roots.join(", ")}`);
    views.push(...landscapeLabels(roots));
    views.push("  }");
    views.push("");

    // --- C4 level 2: the containers of one context --------------------------
    // Services, and the databases they keep their state in. Stores are named:
    // the ones this context's services own, and the ones they only read, which
    // is how a service reading someone else's database shows up as a crossing
    // rather than as a box inside its own walls. The brokers these services
    // publish on or listen to arrive with `*` as neighbours, the way the other
    // contexts do, and are not named: naming the bus would also pull in every
    // other context's hops onto it, which are not this context's picture.
    const contextStores = new Set();
    const contextServiceIds = new Set(context.services.map((s) => s.id));
    for (const service of context.services) {
      for (const store of storesByOwner.get(service.id) ?? [])
        contextStores.add(store.id);
      for (const storeId of service.stores ?? []) {
        if (storeById.has(storeId)) contextStores.add(storeId);
      }
    }
    const include = ["*", ...[...contextStores].map(fqn)].join(", ");
    // Only the pairs the picture holds both ends of: a neighbour in another
    // context is drawn folded into its context, and naming one of its services
    // would unfold it into a second box.
    const inside = ([from, to]) =>
      contextServiceIds.has(from) && contextServiceIds.has(to);
    const pairs = [...callPairs.values()].filter((pair) =>
      inside([pair.from, pair.to]),
    );
    views.push(`  view ${contextViewId(context)} of ${safeId(context.id)} {`);
    views.push(`    title ${q(context.name)}`);
    views.push(`    include ${include}`);
    views.push(...containerCards(context.services));
    views.push(...contextLabels(context));
    views.push(
      ...containerPredicates(pairs, carriedByBus.filter(inside), "    "),
    );
    views.push("  }");

    for (const { id, hidden } of filterVariants(contextViewId(context))) {
      const hiddenRefs = new Set([
        ...(hidden.has("store") ? [...storeById.values()].map((store) => fqn(store.id)) : []),
        ...(hidden.has("broker") ? [...brokerIds].map(safeId) : []),
        ...(hidden.has("external") ? [...rootParticipants].filter(([, meta]) => OUTSIDE.has(meta.kind)).map(([root]) => safeId(root)) : []),
      ]);
      const visible = (reference) => !hiddenRefs.has(reference);
      const shownStores = hidden.has("store") ? [] : [...contextStores].map(fqn);
      views.push(`  view ${id} of ${safeId(context.id)} {`);
      views.push(`    title ${q(context.name)}`);
      views.push(`    include ${["*", ...shownStores].join(", ")}`);
      if (hiddenRefs.size) views.push(`    exclude ${[...hiddenRefs].join(", ")}`);
      views.push(...containerCards(context.services, "    ", !hidden.has("store")));
      views.push(...contextLabels(context, "    ", visible));
      views.push(...containerPredicates(pairs, hidden.has("broker") ? [] : carriedByBus.filter(inside), "    "));
      views.push("  }");
    }
    views.push("");

    for (const service of context.services) {
      // Still level 2, one service deep: the service as a box, and everything
      // that reaches it or that it reaches. Its own parts are excluded by name
      // rather than the subject included by name, because inside a scoped view a
      // dotted reference is read relative to the scope first — and `auth.auth`
      // read from inside `auth.auth` resolves to nothing at all.
      const parts = service.aggregates.map((a) => safeId(a.slug));
      views.push(`  view ${serviceViewId(service)} of ${fqn(service.id)} {`);
      views.push(`    title ${q(`${service.name} — neighbours`)}`);
      views.push("    include *, -> *, * ->");
      if (parts.length > 0) views.push(`    exclude ${parts.join(", ")}`);
      views.push(...neighbourLabels(service, context));
      views.push("  }");

      // --- C4 level 3: inside one service ------------------------------------
      // Its aggregates and its stores. Events are in the model but not in this
      // picture: a service with eleven of them would draw a wall of boxes where
      // the page already lists them, one line each.
      views.push(
        `  view ${serviceInsideViewId(service)} {`,
      );
      views.push(`    title ${q(`${service.name} — inside`)}`);
      const aggregateIds = new Set(service.aggregates.map((aggregate) => aggregate.id));
      const insideStores = new Set([
        ...(storesByOwner.get(service.id) ?? []).map((store) => store.id),
        ...[...persists.values()].filter((edge) => aggregateIds.has(edge.aggregate)).map((edge) => edge.store),
      ]);
      views.push(`    include ${[fqn(service.id), ...[...aggregateIds].map(fqn), ...[...insideStores].map(fqn)].join(", ")}`);
      views.push("    exclude * -> * where kind is owns");
      views.push("  }");
    }
  }
  views.push("");
}
