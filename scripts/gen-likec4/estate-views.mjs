// The estate's own pictures: C4 level 1, level 2 with every container, and
// the pair of them drawn for each catalog profile.

import { CONTAINERS_VIEW, LANDSCAPE_VIEW, includeTargets, profileContainersViewId, profileLandscapeViewId, q, safeId } from "./ids.mjs";

/** The landscape and containers views, and the two of each profile. */
export function estateViews(g) {
  const { catalog, profiles, fqn, views, rootParticipants, peerParticipant, brokerIds, busEdges, actorIds, callPairs, carriedByBus, containerPredicates, containerCards, transportLabels, localQueueRanks, OUTSIDE, outside, landscapeLabels } = g;
  views.push(`  view ${LANDSCAPE_VIEW} {`);
  views.push("    title 'Estate'");
  views.push(
    catalog.contexts.some(
      (context) => context.kind && context.kind !== "bounded-context",
    )
      ? "    description 'Every architecture group, and everything outside the estate that touches one.'"
      : "    description 'Every bounded context, and everything outside the estate that touches one.'",
  );
  views.push(
    `    include ${includeTargets([...catalog.contexts.map((c) => safeId(c.id)), ...outside])}`,
  );
  views.push(...landscapeLabels([...catalog.contexts.map((c) => safeId(c.id)), ...outside]));
  views.push("  }");
  views.push("");

  // --- C4 level 2: every container in the estate -----------------------------
  // The same boxes as the landscape, opened: each context with its services
  // and their stores beside them, the brokers the
  // flows walk through, and the same outsiders as above. One picture of what
  // runs, what it talks to and over which protocol — the diagram most people
  // mean when they ask for "the architecture".
  const brokersOfService = new Map(); // service id -> Set of broker ids
  for (const edge of busEdges.values()) {
    const [service, broker] = brokerIds.has(edge.to)
      ? [edge.from, edge.to]
      : [edge.to, edge.from];
    const set = brokersOfService.get(service) ?? new Set();
    set.add(broker);
    brokersOfService.set(service, set);
  }
  const allServices = catalog.contexts.flatMap((c) => c.services);
  const drawnBrokers = [
    ...new Set(
      allServices.flatMap((s) => [...(brokersOfService.get(s.id) ?? [])]),
    ),
  ];
  views.push(`  view ${CONTAINERS_VIEW} {`);
  views.push("    title 'Containers'");
  views.push(
    "    description 'Every service, the store it keeps its state in, the brokers between them, and everything outside the estate that touches one.'",
  );
  views.push(
    `    include ${includeTargets([
      ...catalog.contexts.map((c) => safeId(c.id)),
      ...allServices.map((s) => fqn(s.id)),
      ...(catalog.stores ?? []).map((store) => fqn(store.id)),
      ...drawnBrokers.map(safeId),
      ...outside,
    ])}`,
  );
  views.push(...containerCards(allServices));
  views.push(...transportLabels(allServices, [...rootParticipants.keys()]));
  views.push(
    ...containerPredicates([...callPairs.values()], carriedByBus, "    "),
  );
  views.push(...localQueueRanks(allServices, [...rootParticipants.keys()]));
  if (outside.some((id) => [...actorIds].some((actor) => safeId(actor) === id)))
    views.push(`    rank source { ${[...actorIds].map(safeId).join(", ")} }`);
  views.push("  }");
  views.push("");

  // The model is the union so shared edges and per-context views are declared
  // once. These two views per profile are the isolated estate entry points the
  // UI uses: only the configured groups and the outsiders their own flows name
  // are included.
  for (const profile of profiles) {
    // An empty context selection is the historical single-catalog manifest's
    // implicit `default` profile. The browser treats it as the whole catalog;
    // the generated views must do the same or it asks for landscape_default
    // while the bundle only contains the unscoped landscape view.
    const profileContexts = profile.contexts.length
      ? catalog.contexts.filter((context) =>
          profile.contexts.includes(context.id),
        )
      : catalog.contexts;
    const profileContextIds = new Set(
      profileContexts.map((context) => context.id),
    );
    const profileServices = profileContexts.flatMap(
      (context) => context.services,
    );
    const profileServiceIds = new Set(
      profileServices.map((service) => service.id),
    );
    const profileRoots = new Set();
    for (const flow of catalog.flows) {
      if (!profileContextIds.has(flow.owner)) continue;
      for (const participant of flow.participants) {
        if (!profileServiceIds.has(participant.id))
          profileRoots.add(participant.id);
      }
    }
    for (const service of profileServices) {
      for (const dependency of service.dependsOn ?? []) {
        if (!profileServiceIds.has(dependency)) profileRoots.add(dependency);
      }
      for (const call of service.consumes) {
        const peer = peerParticipant(call.peer);
        if (peer && !profileServiceIds.has(peer)) profileRoots.add(peer);
      }
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          for (const consumer of event.consumers) {
            if (!profileServiceIds.has(consumer.service))
              profileRoots.add(consumer.service);
          }
        }
      }
    }
    const profileOutside = [...profileRoots]
      .filter((id) => OUTSIDE.has(rootParticipants.get(id)?.kind))
      .map(safeId);
    const profileBrokers = [...profileRoots]
      .filter((id) => rootParticipants.get(id)?.kind === "broker")
      .map(safeId);
    const profileStores = (catalog.stores ?? []).filter((store) =>
      profileServiceIds.has(store.owner),
    );

    views.push(`  view ${profileLandscapeViewId(profile)} {`);
    views.push(`    title ${q(profile.title)}`);
    views.push(
      `    description 'The groups and outside systems selected by this catalog profile.'`,
    );
    views.push(
      `    include ${includeTargets([...profileContexts.map((context) => safeId(context.id)), ...profileOutside])}`,
    );
    views.push(...landscapeLabels([...profileContexts.map((context) => safeId(context.id)), ...profileOutside]));
    views.push("  }");
    views.push("");

    views.push(`  view ${profileContainersViewId(profile)} {`);
    views.push(`    title ${q(`${profile.title} containers`)}`);
    views.push(
      `    description 'The services, stores and transports selected by this catalog profile.'`,
    );
    views.push(
      `    include ${includeTargets([
        ...profileContexts.map((context) => safeId(context.id)),
        ...profileServices.map((service) => fqn(service.id)),
        ...profileStores.map((store) => fqn(store.id)),
        ...profileBrokers,
        ...profileOutside,
      ])}`,
    );
    views.push(...containerCards(profileServices));
    views.push(...transportLabels(profileServices, [...profileRoots]));
    views.push(
      ...containerPredicates(
        [...callPairs.values()].filter(
          (pair) =>
            profileServiceIds.has(pair.from) && (profileServiceIds.has(pair.to) || profileRoots.has(pair.to)),
        ),
        carriedByBus.filter(
          ([from, to]) =>
            profileServiceIds.has(from) && profileServiceIds.has(to),
        ),
        "    ",
      ),
    );
    views.push(...localQueueRanks(profileServices, [...profileRoots]));
    const profileActors = [...actorIds].map(safeId).filter((id) => profileOutside.includes(id));
    if (profileActors.length) views.push(`    rank source { ${profileActors.join(", ")} }`);
    views.push("  }");
    views.push("");
  }
  return { allServices };
}
