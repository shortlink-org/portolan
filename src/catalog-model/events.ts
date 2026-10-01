// Events and how they travel: an event's versions and consumers, its name on
// the wire, the channels a service declares, and the registry schemas behind
// a message.

import type { Catalog } from "./catalog.ts";
import type { EdgeVia, Field, Status } from "./shared.ts";
import { allServices } from "./contexts.ts";

export interface Event {
  id: string; // "<service id>.<aggregate>.<Name>"
  slug: string;
  name: string;
  versions: EventVersion[]; // >=1, oldest first
  consumers: EventConsumer[];
  /**
   * How the event leaves the service. Optional because a hand-written catalog
   * may not know, and an extractor only says what the source declares.
   */
  wire?: EventWire;
}
/**
 * The event as the bus sees it: its name on the message and the channel it
 * is published on. The two are different facts - one topic carries every
 * event of an aggregate, and a subscriber dispatches on the name - and a
 * trace carries both, as `event.name` and `messaging.destination.name`.
 * This is the one place the catalog and a running system meet by string.
 */
export interface EventWire {
  /** "cart.BasketCreated" - the name on the message, as a trace's event.name. */
  name: string;
  /**
   * "cart_basket" - the topic, subject or stream it is published on. Absent
   * when the source names the event but does not say where it goes.
   */
  channel?: string;
}
/**
 * A topic, subject or stream a service says it uses, and the messages that
 * travel on it. This is what an AsyncAPI document declares - the async half of
 * what an OpenAPI document says about routes.
 *
 * The catalog knew about channels before this, but only by inference: an event
 * carries a wire, and a channel was whatever the events happened to name. A
 * declaration is a different fact, and it says two things inference could not.
 * What the service means to put on the bus, whether or not an extractor found
 * an event saying so - and what it listens for, which nothing in a publisher's
 * source could ever say.
 */
export interface Channel {
  /**
   * "shop.cart.basket" - the channel as the broker knows it. The same string an
   * event's `wire.channel` carries, and comparing the two is how a document and
   * the code beside it are held against each other.
   */
  address: string;
  /** Domain event by default; jobs are work queues and messages are generic streams. */
  kind?: "event" | "job" | "message";
  /**
   * The transport the channel lives on, as the source names it: "nats",
   * "kafka", "sqs". Absent when the source does not settle one.
   */
  protocol?: string;
  title?: string;
  doc?: string;
  messages: ChannelMessage[];
  /** The document this was read out of. */
  source?: string;
}
/**
 * Which way a message travels, from this service's side.
 *
 * It decides ownership: a service that sends on a channel publishes on it, and
 * a channel has one publisher. A service that only receives is a subscriber,
 * and any number of those is the point of a bus.
 */
export type ChannelDirection = "send" | "receive";
export interface ChannelMessage {
  /** "cart.BasketCreated" - the name on the message, as an event's wire.name. */
  name: string;
  title?: string;
  doc?: string;
  direction: ChannelDirection;
  /** Normalized payload serialization, such as `msgpack`. */
  encoding?: string;
  /** Exact media type declared by the source contract. */
  contentType?: string;
  /** Exact Schema Registry registration that supplies this message contract. */
  schema?: SchemaRegistration;
}

/** One immutable subject version, with its effective compatibility policy. */
export interface SchemaRegistration {
  registry: string;
  subject: string;
  version: number;
  id: number;
  type: string;
  compatibility?: string;
  /** Oldest first, including the current version, when history was fetched. */
  versions?: SchemaVersion[];
}

export interface SchemaVersion {
  version: number;
  id: number;
  type: string;
  /** Top-level wire fields; absent for formats this extractor does not parse. */
  fields?: SchemaField[];
}

export interface SchemaField {
  name: string;
  type: string;
}
export interface EventConsumer {
  service: string;
  status: Status;
  note?: string;
  /** Set when the consumer was derived from a flow step rather than declared. */
  via?: EdgeVia;
}
/** The protobuf contract that defines one version of an event payload. */
export interface EventSchemaRef {
  /** The schema module that owns the message, by `ProtoModule.id`. */
  module: string;
  /** Fully-qualified protobuf message name, for example `shop.events.v2.OrderPlaced`. */
  message: string;
}
export interface EventVersion {
  version: string;
  doc: string;
  /** This version is superseded, per a `@deprecated` on the class that carries it. */
  deprecated?: boolean;
  source: string;
  fields: Field[];
  /** Registry-backed protobuf contract for this exact event version. */
  schema?: EventSchemaRef;
}

export function allEvents(catalog: Catalog): Event[] {
  return allServices(catalog).flatMap((s) =>
    s.aggregates.flatMap((a) => a.events),
  );
}
