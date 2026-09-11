// The optional hand-off from a catalogued Kafka topic to the operational UI.
//
// The configured value belongs to the reader, not to the catalog: two readers
// can use different Kafka UI installations for the same generated estate. It
// therefore lives in localStorage, like the editor and display preferences.
// A cluster URL gives us enough information to open the exact topic; a plain
// installation URL remains useful and opens Kafka UI without inventing a
// cluster name.

import type { Catalog, Channel } from "../catalog";
import { walkSteps } from "../catalog";
import { createIntegrationStore, normalizeIntegrationUrl } from "./integration-url";

export const KAFKA_UI_KEY = "portolan.integrations.kafka-ui";

export const normalizeKafkaUiUrl = normalizeIntegrationUrl;

/** Build Kafbat's topic route when the configured URL names a cluster. */
export function kafkaUiTopicUrl(
  configured: string,
  topic: string,
): string | null {
  const normalized = normalizeKafkaUiUrl(configured);
  if (!normalized) return null;
  const url = new URL(normalized);
  const match = url.pathname.match(
    /^(.*\/ui\/clusters\/[^/]+)(?:\/.*)?$/,
  );
  if (!match?.[1]) return normalized;
  url.pathname = `${match[1]}/all-topics/${encodeURIComponent(topic)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Topic addresses whose source-backed flow explicitly says Kafka. */
export function kafkaHandoffChannels(catalog: Pick<Catalog, "flows">): Set<string> {
  const channels = new Set<string>();
  for (const flow of catalog.flows) {
    for (const step of walkSteps(flow.steps)) {
      if (step.handoff?.transport.toLowerCase() === "kafka") {
        channels.add(step.handoff.channel);
      }
    }
  }
  return channels;
}

/**
 * A channel is Kafka only when an extractor said so in its presentation facts
 * or a matching flow carries explicit Kafka transport evidence. Channel itself
 * predates the transport field, so address alone is deliberately insufficient.
 */
export function isKafkaChannel(
  channel: Pick<Channel, "address" | "title" | "doc">,
  handoffChannels: ReadonlySet<string>,
): boolean {
  const description = `${channel.title ?? ""} ${channel.doc ?? ""}`;
  return /(^|[^a-z0-9])kafka([^a-z0-9]|$)/i.test(description)
    || handoffChannels.has(channel.address);
}

export const useKafkaUi = createIntegrationStore(KAFKA_UI_KEY);
