// Where two services meet on one channel, and where a service's document and
// its code do not tell the same story about the bus.
//
// A channel belongs to the service that publishes on it, the way a store
// belongs to the service that writes it: a subscriber to `shop.cart.basket`
// is told, by the name, whose events it is reading and whose schema to vendor.
// A second publisher on the same channel breaks that promise silently - the
// subscriber dispatches on the event's name and never notices the message
// came from somewhere else, until one arrives that it cannot parse.
//
// Two sources say what a service puts on the bus, and they are read out of
// different files by different extractors. The domain says an aggregate raises
// an event and how it leaves, in `wire`. An AsyncAPI document says the service
// declares a channel and what travels on it, in `channels`. Neither is the
// truth on its own - a document is a promise and a wire is what the code does -
// and where they disagree is a fact worth a row, because one of them is stale.
//
// This is the messaging half of `shared-store`. It is done here, over the
// merged catalog, for the same reason the store rule is: each extractor sees
// one repository and cannot know what another declares.

import type { Catalog, CatalogIndex, Event, Service } from "../catalog";
import type { Problem } from "./derive";

interface Publisher {
  service: Service;
  context: string;
  /** The events of this service whose wire names the channel. */
  events: Event[];
  /** Whether the service's own document declares it sends here. */
  declared: boolean;
}

export function wireProblems(
  catalog: Catalog,
  index: CatalogIndex,
): Problem[] {
  return [
    ...sharedChannels(catalog),
    ...documentAgainstCode(catalog),
    ...unresolvedSubscriptions(catalog, index),
  ];
}

/**
 * Every service that publishes on a channel another service publishes on
 * too: one row per service per such channel, pointing at the other side.
 *
 * Publishing is either of the two claims - an event whose wire names the
 * channel, or a document declaring a send on it - because both are the service
 * saying it owns the channel, and a document that says so while the code has
 * not caught up is the same collision one release earlier.
 *
 * A service with several aggregates on one channel is not this: the channel
 * is still one service's. An event without a wire is skipped, because a
 * channel nobody named cannot be shared.
 */
function sharedChannels(catalog: Catalog): Problem[] {
  const byChannel = new Map<string, Map<string, Publisher>>();

  const publisher = (
    channel: string,
    service: Service,
    context: string,
  ): Publisher => {
    const publishers = byChannel.get(channel) ?? new Map<string, Publisher>();
    byChannel.set(channel, publishers);
    const mine = publishers.get(service.id) ?? {
      service,
      context,
      events: [],
      declared: false,
    };
    publishers.set(service.id, mine);

    return mine;
  };

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const channel = event.wire?.channel;
          if (!channel) continue;
          publisher(channel, service, context.id).events.push(event);
        }
      }

      for (const channel of service.channels ?? []) {
        if (!sends(channel.messages)) continue;
        publisher(channel.address, service, context.id).declared = true;
      }
    }
  }

  const out: Problem[] = [];
  for (const [channel, publishers] of byChannel) {
    if (publishers.size < 2) continue;
    for (const mine of publishers.values()) {
      for (const theirs of publishers.values()) {
        if (theirs === mine) continue;
        const [first] = mine.events;
        out.push({
          kind: "shared-channel",
          // An error, like a second writer in a database: a subscriber vendors
          // one publisher's schema, and a message from the other is one it
          // will fail on, not one it will merely misfile.
          severity: "error",
          context: mine.context,
          service: mine.service.id,
          // The near end is one event when this side has one, so the row leads
          // to a page; a side known only from its document leads to the
          // service, which is the only page there is.
          id: first?.id ?? mine.service.id,
          peer: theirs.service.id,
          note: `${mine.service.id} publishes on ${channel}, and so does ${theirs.service.id}: ${claim(theirs, channel)}. A subscriber reads both without being told.`,
          source: first?.versions[0]?.source ?? sourceOf(mine.service, channel),
        });
      }
    }
  }

  return out;
}

/** What a publisher is putting on a channel, as the catalog knows it. */
function claim(publisher: Publisher, channel: string): string {
  if (publisher.events.length > 0) {
    return publisher.events.map((e) => e.name).join(", ");
  }

  const declared = publisher.service.channels?.find(
    (c) => c.address === channel,
  );

  return (
    declared?.messages
      .filter((m) => m.direction === "send")
      .map((m) => m.name)
      .join(", ") ?? "nothing the catalog can name"
  );
}

/**
 * Where a service's document and its own code disagree about the bus.
 *
 * Both directions are a warning rather than an error, and for the same reason:
 * neither claim is wrong on its own. A channel the code publishes on and the
 * document does not declare is a document that has fallen behind - or an event
 * going out where nobody agreed it would. A channel the document declares and
 * no event names is a promise nothing keeps yet.
 *
 * A service with no document says nothing here. Silence is not a disagreement,
 * and a rule that fired on every service without an AsyncAPI file would be a
 * page of rows about work nobody has started.
 */
function documentAgainstCode(catalog: Catalog): Problem[] {
  const out: Problem[] = [];

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      const channels = service.channels ?? [];
      if (channels.length === 0) continue;

      const declared = new Set(
        channels.filter((c) => sends(c.messages)).map((c) => c.address),
      );
      const published = new Map<string, Event>();

      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          const channel = event.wire?.channel;
          if (!channel) continue;
          if (!published.has(channel)) published.set(channel, event);
          if (declared.has(channel)) continue;

          out.push({
            kind: "channel-undeclared",
            severity: "warning",
            context: context.id,
            service: service.id,
            id: event.id,
            peer: channel,
            note: `${event.name} goes out on ${channel}, which ${service.id} does not declare it sends on. A subscriber reading the document does not know this message exists.`,
            source: event.versions[0]?.source,
          });
        }
      }

      for (const channel of channels) {
        if (!sends(channel.messages)) continue;
        if (published.has(channel.address)) continue;

        out.push({
          kind: "channel-unpublished",
          severity: "warning",
          context: context.id,
          service: service.id,
          id: service.id,
          peer: channel.address,
          note: `${service.id} declares it sends on ${channel.address}, and no event of it names that channel: ${channel.messages
            .filter((m) => m.direction === "send")
            .map((m) => m.name)
            .join(", ")}.`,
          source: channel.source,
        });
      }
    }
  }

  return out;
}

/**
 * A message a service listens for that nothing in the estate publishes.
 *
 * This is the only edge in the catalog that runs the other way. Everywhere else
 * the publisher names its consumers and a name that resolves to nobody is the
 * problem; here the subscriber names a message, and the estate is searched for
 * whoever puts it on the wire. A subscription that resolves is how two
 * repositories that never mention each other are found to be joined.
 */
function unresolvedSubscriptions(
  catalog: Catalog,
  index: CatalogIndex,
): Problem[] {
  // Every name anything in the estate puts on the wire. The index knows the
  // events; a document declaring a send is the other half, and it counts for
  // the same reason it counts as publishing above - the code may simply not
  // have caught up with it yet.
  const published = new Set(index.eventByWireName.keys());
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const channel of service.channels ?? []) {
        for (const message of channel.messages) {
          if (message.direction === "send") published.add(message.name);
        }
      }
    }
  }

  const out: Problem[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const channel of service.channels ?? []) {
        for (const message of channel.messages) {
          if (message.direction !== "receive") continue;
          if (published.has(message.name)) continue;

          out.push({
            kind: "subscription-unresolved",
            severity: "warning",
            context: context.id,
            service: service.id,
            id: service.id,
            peer: message.name,
            note: `${service.id} listens on ${channel.address} for ${message.name}, and nothing in the catalog publishes it. Either the publisher is outside the estate, or the name has drifted.`,
            source: channel.source,
          });
        }
      }
    }
  }

  return out;
}

function sends(messages: { direction: string }[]): boolean {
  return messages.some((m) => m.direction === "send");
}

function sourceOf(service: Service, channel: string): string | undefined {
  return service.channels?.find((c) => c.address === channel)?.source;
}
