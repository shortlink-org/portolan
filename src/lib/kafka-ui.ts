// The optional hand-off from a catalogued Kafka topic to the operational UI.
//
// The configured value belongs to the reader, not to the catalog: two readers
// can use different Kafka UI installations for the same generated estate. It
// therefore lives in localStorage, like the editor and display preferences.
// A cluster URL gives us enough information to open the exact topic; a plain
// installation URL remains useful and opens Kafka UI without inventing a
// cluster name.

import { create } from "zustand";
import type { Catalog, Channel } from "../catalog";
import { walkSteps } from "../catalog";

export const KAFKA_UI_KEY = "portolan.integrations.kafka-ui";

export function normalizeKafkaUiUrl(value: string): string | null {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const url = new URL(clean);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

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

function read(): string {
  try {
    const value = localStorage.getItem(KAFKA_UI_KEY) ?? "";
    return normalizeKafkaUiUrl(value) ?? "";
  } catch {
    return "";
  }
}

function write(value: string): void {
  try {
    if (value) localStorage.setItem(KAFKA_UI_KEY, value);
    else localStorage.removeItem(KAFKA_UI_KEY);
  } catch {
    /* private mode: keep the value for this session */
  }
}

interface KafkaUiState {
  url: string;
  setUrl: (url: string) => void;
}

export const useKafkaUi = create<KafkaUiState>()((set) => ({
  url: read(),
  setUrl: (url) => {
    const normalized = normalizeKafkaUiUrl(url);
    if (normalized === null) return;
    write(normalized);
    set({ url: normalized });
  },
}));
