// What a service says on the bus, channel by channel.
//
// These are catalog facts, not a rendering of the document they came from, and
// the difference is the links. A message this service sends is an event
// somewhere in the catalog, and the row leads to it; a message it receives is
// an event some other service publishes, and the row leads there too, across a
// repository boundary neither side names. That is the whole payoff of reading
// the document into the catalog rather than only drawing it: the arrow between
// two services that never mention each other.
//
// A name that resolves to nothing is left as plain text rather than hidden. It
// is either a publisher outside the estate or a name that has drifted, and the
// Problems page says which; a row that quietly dropped it would be the site
// hiding the interesting case.
//
// Direction is the first thing a reader asks of a channel - what goes out, what
// comes in - so it is drawn, not only written: an arrow and a colour per
// direction, a filter to keep one, and a grouping that folds the two rows a
// message has on a work queue (put on, worked) into one.

import { ArrowDownLeft, ArrowUpRight, ExternalLink, Layers } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { Channel, ChannelDirection, ChannelMessage } from "../catalog";
import { catalog, index } from "../data";
import {
  isKafkaChannel,
  kafkaHandoffChannels,
  kafkaUiTopicUrl,
  useKafkaUi,
} from "../lib/kafka-ui";
import { eventPath } from "../routes";
import { Ident } from "./Ident";
import { RowActions } from "./RowActions";

const KAFKA_HANDOFF_CHANNELS = kafkaHandoffChannels(catalog);

export type DirectionFilter = "all" | ChannelDirection;

/** The event that goes out under a wire name, when the catalog knows one. */
function publisherOf(name: string) {
  const event = index.eventByWireName.get(name);
  if (!event) return null;
  const owner = index.eventOwner.get(event.id);
  const path = eventPath(event.id);
  if (!owner || !path) return null;

  return { event, owner, path };
}

const DIRECTION = {
  send: {
    Icon: ArrowUpRight,
    className: "chip dir-send",
    title: "this service puts it on the channel",
  },
  receive: {
    Icon: ArrowDownLeft,
    className: "chip dir-receive",
    title: "this service listens for it",
  },
} as const;

function DirectionChip({ direction }: { direction: ChannelDirection }) {
  const { Icon, className, title } = DIRECTION[direction];
  return (
    <span className={className} title={title} data-direction={direction}>
      <Icon size={11} aria-hidden />
      {direction}
    </span>
  );
}

/**
 * One row: a message and the directions it travels. Ungrouped, a message that
 * is both sent and received is two rows with one direction each; grouped, it
 * is one row wearing both chips.
 */
function MessageRow({
  message,
  directions,
  mine,
}: {
  message: ChannelMessage;
  directions: readonly ChannelDirection[];
  /** The service this channel belongs to, so a row can say when the publisher is someone else. */
  mine: string;
}) {
  const published = publisherOf(message.name);
  const elsewhere =
    published !== null && published.owner.service.id !== mine
      ? published.owner.service.id
      : null;

  return (
    <li className="row rounded-none border-x-0 border-t-0 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          {directions.map((direction) => (
            <DirectionChip key={direction} direction={direction} />
          ))}
          {published ? (
            <Link
              to={published.path}
              data-peek={published.event.id}
              className="mono text-accent hover:underline"
            >
              {message.name}
            </Link>
          ) : (
            <Ident value={message.name} />
          )}
          {elsewhere ? (
            <span className="chip" title="published by another service">
              {elsewhere}
            </span>
          ) : null}
          {message.encoding || message.contentType ? (
            <span className="chip mono" title={message.contentType || "payload encoding"}>
              {message.encoding || message.contentType}
            </span>
          ) : null}
        </div>
        {message.title || message.doc ? (
          <p className="mt-0.5 text-muted">{message.doc || message.title}</p>
        ) : null}
      </div>
      <RowActions copy={message.name} />
    </li>
  );
}

/** A message with every direction it travels on the channel, in send-then-receive order. */
interface MessageGroup {
  message: ChannelMessage;
  directions: ChannelDirection[];
}

/**
 * The rows a channel shows: one per message and direction, or - grouped - one
 * per message with both directions, the sent one supplying the doc because it
 * is what the sender wrote down. A filter keeps one direction; a grouped row
 * that loses its other half keeps the chip it still has.
 */
export function rowsOf(
  messages: readonly ChannelMessage[],
  filter: DirectionFilter,
  grouped: boolean,
): MessageGroup[] {
  const kept = messages.filter(
    (message) => filter === "all" || message.direction === filter,
  );
  if (!grouped) {
    return kept.map((message) => ({ message, directions: [message.direction] }));
  }
  const groups: MessageGroup[] = [];
  for (const message of kept) {
    const group = groups.find((g) => g.message.name === message.name);
    if (!group) {
      groups.push({ message, directions: [message.direction] });
    } else {
      if (!group.directions.includes(message.direction)) {
        group.directions.push(message.direction);
      }
      // The sent message carries the sender's doc; a receive found first is
      // replaced by it, so that a grouped row reads the same either way.
      if (message.direction === "send" && group.message.direction === "receive") {
        group.message = message;
      }
    }
  }
  for (const group of groups) {
    group.directions.sort((a, b) => (a === b ? 0 : a === "send" ? -1 : 1));
  }
  return groups;
}

/** How many messages travel each way, across every channel. */
export function countDirections(channels: readonly Channel[]) {
  let send = 0;
  let receive = 0;
  for (const channel of channels) {
    for (const message of channel.messages) {
      if (message.direction === "send") send += 1;
      else receive += 1;
    }
  }
  return { send, receive };
}

export function ChannelRows({
  channels,
  service,
}: {
  channels: Channel[];
  service: string;
}) {
  const kafkaUi = useKafkaUi((state) => state.url);
  // The filter and the grouping live in the URL beside the tab, so that the
  // view a reader ends up with is the one their link opens.
  const [params, setParams] = useSearchParams();
  const dir = params.get("dir");
  const filter: DirectionFilter =
    dir === "send" || dir === "receive" ? dir : "all";
  const grouped = params.get("group") === "message";
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const counts = countDirections(channels);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg bg-canvas" role="group" aria-label="Direction shown">
          <button
            type="button"
            onClick={() => set("dir", null)}
            aria-pressed={filter === "all"}
            className={filter === "all" ? "is-on" : ""}
            title="Every message, both ways"
          >
            all <span className="tnum text-muted">{counts.send + counts.receive}</span>
          </button>
          <button
            type="button"
            onClick={() => set("dir", "send")}
            aria-pressed={filter === "send"}
            className={filter === "send" ? "is-on" : ""}
            title="Only what this service puts on a channel"
          >
            <ArrowUpRight size={11} aria-hidden className="inline" /> send{" "}
            <span className="tnum text-muted">{counts.send}</span>
          </button>
          <button
            type="button"
            onClick={() => set("dir", "receive")}
            aria-pressed={filter === "receive"}
            className={filter === "receive" ? "is-on" : ""}
            title="Only what this service listens for"
          >
            <ArrowDownLeft size={11} aria-hidden className="inline" /> receive{" "}
            <span className="tnum text-muted">{counts.receive}</span>
          </button>
        </div>
        <div className="seg bg-canvas" role="group" aria-label="Grouping">
          <button
            type="button"
            onClick={() => set("group", grouped ? null : "message")}
            aria-pressed={grouped}
            className={grouped ? "is-on" : ""}
            title="One row per message, with every direction it travels"
          >
            <Layers size={11} aria-hidden className="inline" /> by message
          </button>
        </div>
      </div>
      <ChannelRowsContent
        channels={channels}
        service={service}
        kafkaUi={kafkaUi}
        filter={filter}
        grouped={grouped}
      />
    </div>
  );
}

/** The presentational half is exported so the generated links can be rendered in isolation. */
export function ChannelRowsContent({
  channels,
  service,
  kafkaUi,
  filter = "all",
  grouped = false,
}: {
  channels: Channel[];
  service: string;
  kafkaUi: string;
  filter?: DirectionFilter;
  grouped?: boolean;
}) {
  return (
    <div className="flex flex-col gap-section" data-nav-list>
      {channels.map((channel) => {
        const rows = rowsOf(channel.messages, filter, grouped);
        return (
          <div key={channel.address} className="rounded-card border border-line">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                <Ident value={channel.address} />
                {channel.kind === "job" ? (
                  <span className="chip">work queue</span>
                ) : channel.kind === "message" ? (
                  <span className="chip">message stream</span>
                ) : null}
                {channel.title ? (
                  <span className="text-muted">{channel.title}</span>
                ) : null}
              </div>
              {kafkaUi && isKafkaChannel(channel, KAFKA_HANDOFF_CHANNELS) ? (
                <a
                  href={kafkaUiTopicUrl(kafkaUi, channel.address) ?? kafkaUi}
                  target="_blank"
                  rel="noreferrer"
                  className="mono inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-control text-accent hover:underline"
                  title={`Open ${channel.address} in Kafka UI`}
                >
                  view in Kafka UI <ExternalLink size={12} aria-hidden />
                </a>
              ) : null}
            </div>
            {channel.doc ? (
              <p className="px-3 py-2 text-muted">{channel.doc}</p>
            ) : null}
            {channel.messages.length === 0 ? (
              <p className="px-3 py-2 text-muted">
                declared, and no operation says which way it travels
              </p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-2 text-muted">
                {filter === "send" ? "nothing sent" : "nothing received"}
              </p>
            ) : (
              <ul>
                {rows.map(({ message, directions }) => (
                  <MessageRow
                    key={`${directions.join("+")} ${message.name}`}
                    message={message}
                    directions={directions}
                    mine={service}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
