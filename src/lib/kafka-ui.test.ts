import { describe, expect, it } from "vitest";
import type { Catalog, Channel } from "../catalog";
import {
  isKafkaChannel,
  kafkaHandoffChannels,
  kafkaUiTopicUrl,
  normalizeKafkaUiUrl,
} from "./kafka-ui";

describe("Kafka UI integration", () => {
  it("accepts web URLs and rejects values that cannot be opened safely", () => {
    expect(normalizeKafkaUiUrl(" https://kafka.example/ ")).toBe(
      "https://kafka.example",
    );
    expect(normalizeKafkaUiUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeKafkaUiUrl("not a URL")).toBeNull();
    expect(normalizeKafkaUiUrl("  ")).toBe("");
  });

  it("opens the exact topic from a Kafbat cluster URL behind a path prefix", () => {
    expect(
      kafkaUiTopicUrl(
        "https://ops.example/kafka/ui/clusters/prod/all-topics/old",
        "orders/new",
      ),
    ).toBe(
      "https://ops.example/kafka/ui/clusters/prod/all-topics/orders%2Fnew",
    );
  });

  it("keeps a plain installation URL as the useful fallback", () => {
    expect(kafkaUiTopicUrl("https://kafka.example", "orders.created")).toBe(
      "https://kafka.example",
    );
  });

  it("recognizes both Kafka-labelled cards and explicit Kafka handoffs", () => {
    const labelled: Channel = {
      address: "orders.created",
      title: "Kafka · orders.created",
      messages: [],
    };
    const flowOnly: Channel = {
      address: "payments.accepted",
      title: "message stream",
      messages: [],
    };
    const nats: Channel = {
      address: "shop.cart",
      title: "JetStream subject",
      messages: [],
    };
    const catalog = {
      flows: [
        {
          id: "payment-kafka",
          slug: "payment-kafka",
          name: "Payment Kafka",
          summary: "",
          owner: "payments",
          participants: [],
          steps: [
            {
              type: "step",
              id: "publish",
              from: "payments",
              to: "broker",
              kind: "event",
              status: "verified",
              handoff: {
                kind: "message",
                transport: "kafka",
                channel: "payments.accepted",
                direction: "send",
              },
            },
          ],
        },
      ],
    } as Pick<Catalog, "flows">;
    const handoffs = kafkaHandoffChannels(catalog);

    expect(isKafkaChannel(labelled, handoffs)).toBe(true);
    expect(isKafkaChannel(flowOnly, handoffs)).toBe(true);
    expect(isKafkaChannel(nats, handoffs)).toBe(false);
  });
});
