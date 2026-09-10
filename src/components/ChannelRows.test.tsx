import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Channel } from "../catalog";
import { ChannelRowsContent } from "./ChannelRows";

const kafka: Channel = {
  address: "orders/created",
  kind: "message",
  title: "Kafka · orders/created",
  messages: [],
};

const nats: Channel = {
  address: "orders.created",
  kind: "message",
  title: "JetStream subject",
  messages: [],
};

describe("ChannelRows Kafka UI integration", () => {
  it("links only Kafka cards to their exact topic when configured", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent
          channels={[kafka, nats]}
          service="shop.orders"
          kafkaUi="https://ops.example/ui/clusters/prod"
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("view in Kafka UI");
    expect(markup).toContain(
      'href="https://ops.example/ui/clusters/prod/all-topics/orders%2Fcreated"',
    );
    expect(markup.match(/view in Kafka UI/g)).toHaveLength(1);
  });

  it("does not offer an operational link before Kafka UI is configured", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent
          channels={[kafka]}
          service="shop.orders"
          kafkaUi=""
        />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("view in Kafka UI");
  });

});
