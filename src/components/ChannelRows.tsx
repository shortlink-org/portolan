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

import { Link } from "react-router";
import type { Channel, ChannelMessage } from "../catalog";
import { index } from "../data";
import { eventPath } from "../routes";
import { Ident } from "./Ident";
import { RowActions } from "./RowActions";

/** The event that goes out under a wire name, when the catalog knows one. */
function publisherOf(name: string) {
  const event = index.eventByWireName.get(name);
  if (!event) return null;
  const owner = index.eventOwner.get(event.id);
  const path = eventPath(event.id);
  if (!owner || !path) return null;

  return { event, owner, path };
}

function MessageRow({
  message,
  mine,
}: {
  message: ChannelMessage;
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
          <span
            className="chip mono"
            title={
              message.direction === "send"
                ? "this service puts it on the channel"
                : "this service listens for it"
            }
          >
            {message.direction}
          </span>
          {published ? (
            <Link to={published.path} className="mono text-accent hover:underline">
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
        </div>
        {message.title || message.doc ? (
          <p className="mt-0.5 text-muted">{message.doc || message.title}</p>
        ) : null}
      </div>
      <RowActions copy={message.name} />
    </li>
  );
}

export function ChannelRows({
  channels,
  service,
}: {
  channels: Channel[];
  service: string;
}) {
  return (
    <div className="flex flex-col gap-section" data-nav-list>
      {channels.map((channel) => (
        <div key={channel.address} className="rounded-card border border-line">
          <div className="flex flex-wrap items-baseline gap-x-2 border-b border-line px-3 py-2">
            <Ident value={channel.address} />
            {channel.title ? (
              <span className="text-muted">{channel.title}</span>
            ) : null}
          </div>
          {channel.doc ? (
            <p className="px-3 py-2 text-muted">{channel.doc}</p>
          ) : null}
          {channel.messages.length === 0 ? (
            <p className="px-3 py-2 text-muted">
              declared, and no operation says which way it travels
            </p>
          ) : (
            <ul>
              {channel.messages.map((message) => (
                <MessageRow
                  key={`${message.direction} ${message.name}`}
                  message={message}
                  mine={service}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
