import type {
  Catalog,
  Channel,
  ChannelDirection,
  ChannelMessage,
} from "../catalog";

export type MessagingIssue =
  | "clear"
  | "no operation"
  | "no publisher"
  | "multiple publishers";

export type ChannelUsage = ChannelDirection | "both" | "none";

export interface ChannelClaim {
  id: string;
  contextId: string;
  contextName: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  address: string;
  protocol: string;
  kind: Channel["kind"];
  title?: string;
  doc?: string;
  source?: string;
  messages: number;
  direction: ChannelUsage;
  issue: MessagingIssue;
}

export interface MessageClaim {
  id: string;
  contextId: string;
  contextName: string;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  address: string;
  protocol: string;
  channelKind: Channel["kind"];
  channelTitle?: string;
  channelDoc?: string;
  source?: string;
  name: string;
  title?: string;
  doc?: string;
  direction: ChannelDirection;
  encoding?: string;
  contentType?: string;
  schema?: ChannelMessage["schema"];
  issue: MessagingIssue;
}

function part(value: string): string {
  return encodeURIComponent(value);
}

/** Stable within a catalog, while keeping identical declarations service-scoped. */
export function channelClaimId(serviceId: string, address: string): string {
  return `channel|${part(serviceId)}|${part(address)}`;
}

/** A service may legitimately send and receive the same message, so direction is part of its claim. */
export function messageClaimId(
  serviceId: string,
  address: string,
  direction: ChannelDirection,
  name: string,
): string {
  return `message|${part(serviceId)}|${part(address)}|${direction}|${part(name)}`;
}

function messageKey(address: string, name: string, environment = ""): string {
  return `${environment}\u0000${address}\u0000${name}`;
}

function channelAddresses(channel: Channel): Array<{ address: string; environment: string }> {
  if (channel.configuredAddresses?.length) {
    return channel.configuredAddresses.map(({ address, environment }) => ({
      address,
      environment,
    }));
  }
  return [{ address: channel.address, environment: "" }];
}

function usage(messages: readonly ChannelMessage[]): ChannelUsage {
  const send = messages.some((message) => message.direction === "send");
  const receive = messages.some((message) => message.direction === "receive");
  if (send && receive) return "both";
  if (send) return "send";
  if (receive) return "receive";
  return "none";
}

/**
 * Documentation inventory derived from declarations, not a new identity model.
 * Every row remains one service's claim; matching addresses only power comparison.
 */
export function messagingClaims(catalog: Catalog): {
  channels: ChannelClaim[];
  messages: MessageClaim[];
} {
  const publishers = new Map<string, Set<string>>();
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        for (const event of aggregate.events) {
          if (!event.wire?.channel) continue;
          const key = messageKey(event.wire.channel, event.wire.name);
          const services = publishers.get(key) ?? new Set<string>();
          services.add(service.id);
          publishers.set(key, services);
        }
      }
      for (const channel of service.channels ?? []) {
        for (const message of channel.messages) {
          if (message.direction !== "send") continue;
          for (const configured of channelAddresses(channel)) {
            const key = messageKey(configured.address, message.name, configured.environment);
            const services = publishers.get(key) ?? new Set<string>();
            services.add(service.id);
            publishers.set(key, services);
          }
        }
      }
    }
  }

  const channels: ChannelClaim[] = [];
  const messages: MessageClaim[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const channel of service.channels ?? []) {
        const messageIssues = channel.messages.map((message): MessagingIssue => {
          const counts = channelAddresses(channel).map(
            ({ address, environment }) =>
              publishers.get(messageKey(address, message.name, environment))?.size ?? 0,
          );
          if (counts.some((count) => count > 1)) return "multiple publishers";
          if (message.direction === "receive" && counts.some((count) => count === 0)) {
            return "no publisher";
          }
          return "clear";
        });
        const issue: MessagingIssue =
          channel.messages.length === 0
            ? "no operation"
            : messageIssues.includes("multiple publishers")
              ? "multiple publishers"
              : messageIssues.includes("no publisher")
                ? "no publisher"
                : "clear";

        channels.push({
          id: channelClaimId(service.id, channel.address),
          contextId: context.id,
          contextName: context.name,
          serviceId: service.id,
          serviceName: service.name,
          serviceSlug: service.slug,
          address: channel.address,
          protocol: channel.protocol ?? "unknown",
          kind: channel.kind,
          title: channel.title,
          doc: channel.doc,
          source: channel.source,
          messages: channel.messages.length,
          direction: usage(channel.messages),
          issue,
        });

        channel.messages.forEach((message, at) => {
          messages.push({
            id: `${messageClaimId(service.id, channel.address, message.direction, message.name)}|${at}`,
            contextId: context.id,
            contextName: context.name,
            serviceId: service.id,
            serviceName: service.name,
            serviceSlug: service.slug,
            address: channel.address,
            protocol: channel.protocol ?? "unknown",
            channelKind: channel.kind,
            channelTitle: channel.title,
            channelDoc: channel.doc,
            source: channel.source,
            name: message.name,
            title: message.title,
            doc: message.doc,
            direction: message.direction,
            encoding: message.encoding,
            contentType: message.contentType,
            schema: message.schema,
            issue: messageIssues[at] ?? "clear",
          });
        });
      }
    }
  }
  return { channels, messages };
}
