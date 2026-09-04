// Where two services meet on one channel.
//
// A channel belongs to the service that publishes on it, the way a store
// belongs to the service that writes it: a subscriber to `shop.cart.basket`
// is told, by the name, whose events it is reading and whose schema to vendor.
// A second publisher on the same channel breaks that promise silently - the
// subscriber dispatches on the event's name and never notices the message
// came from somewhere else, until one arrives that it cannot parse.
//
// This is the messaging half of `shared-store`. It is done here, over the
// merged catalog, for the same reason the store rule is: each extractor sees
// one repository and cannot know what another declares.

import type { Catalog, CatalogIndex, Event, Service } from "../catalog";
import type { Problem } from "./derive";

interface Publisher {
  service: Service;
  context: string;
  events: Event[];
}

/**
 * Every service that publishes on a channel another service publishes on
 * too: one row per service per such channel, pointing at the other side.
 *
 * A service with several aggregates on one channel is not this: the channel
 * is still one service's. An event without a wire is skipped, because a
 * channel nobody named cannot be shared.
 */
export function wireProblems(
  catalog: Catalog,
  index: CatalogIndex,
): Problem[] {
  const byChannel = new Map<string, Map<string, Publisher>>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const channel = event.wire?.channel;
          if (!channel) continue;
          const publishers = byChannel.get(channel) ?? new Map();
          byChannel.set(channel, publishers);
          const mine = publishers.get(service.id) ?? {
            service,
            context: context.id,
            events: [],
          };
          publishers.set(service.id, mine);
          mine.events.push(event);
        }
      }
    }
  }

  const out: Problem[] = [];
  for (const [channel, publishers] of byChannel) {
    if (publishers.size < 2) continue;
    for (const mine of publishers.values()) {
      const [first] = mine.events;
      if (!first) continue;
      for (const theirs of publishers.values()) {
        if (theirs === mine) continue;
        const names = theirs.events.map((e) => e.name).join(", ");
        out.push({
          kind: "shared-channel",
          // An error, like a second writer in a database: a subscriber vendors
          // one publisher's schema, and a message from the other is one it
          // will fail on, not one it will merely misfile.
          severity: "error",
          context: mine.context,
          service: mine.service.id,
          // The near end is one event, so the row leads to a page; the note
          // says the channel carries every event of the service.
          id: first.id,
          peer: theirs.service.id,
          note: `${mine.service.id} publishes on ${channel}, and so does ${theirs.service.id}: ${names}. A subscriber reads both without being told.`,
          source: first.versions[0]?.source,
        });
      }
    }
  }

  // Skipped: the index is here for the shape every rule module shares, and
  // because a later rule about channels will need it.
  void index;
  return out;
}
