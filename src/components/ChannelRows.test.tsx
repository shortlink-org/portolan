import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Channel } from "../catalog";
import { ChannelRowsContent, countDirections, rowsOf } from "./ChannelRows";

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

/** A work queue the way extract-laravel and extract-celery write one: a job put on and worked. */
const queue: Channel = {
  address: "default",
  kind: "job",
  title: "Queue · default",
  messages: [
    { name: "App\\Jobs\\IndexOrder", title: "IndexOrder", doc: "Puts the order in the index.", direction: "send" },
    { name: "App\\Jobs\\IndexOrder", title: "IndexOrder", doc: "Worked by `IndexOrder::handle`.", direction: "receive" },
    { name: "App\\Jobs\\ImportBatch", title: "ImportBatch", doc: "Worked by `ImportBatch::handle`.", direction: "receive" },
  ],
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

describe("ChannelRows direction", () => {
  it("draws each direction as its own chip", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent channels={[queue]} service="shop.app" kafkaUi="" />
      </MemoryRouter>,
    );
    expect(markup.match(/data-direction="send"/g)).toHaveLength(1);
    expect(markup.match(/data-direction="receive"/g)).toHaveLength(2);
    expect(markup).toContain('class="chip dir-send"');
    expect(markup).toContain('class="chip dir-receive"');
  });

  it("keeps one direction when filtered, and says so when a channel has none of it", () => {
    const rows = rowsOf(queue.messages, "send", false);
    expect(rows.map((r) => `${r.directions[0]} ${r.message.title}`)).toEqual(["send IndexOrder"]);

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent channels={[queue]} service="shop.app" kafkaUi="" filter="send" />
      </MemoryRouter>,
    );
    expect(markup).not.toContain("ImportBatch");
    expect(markup).not.toContain("nothing sent");

    const empty = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent
          channels={[{ ...queue, messages: queue.messages.filter((m) => m.direction === "receive") }]}
          service="shop.app"
          kafkaUi=""
          filter="send"
        />
      </MemoryRouter>,
    );
    expect(empty).toContain("nothing sent");
  });

  it("folds the send and receive of one message into a row wearing both chips", () => {
    const rows = rowsOf(queue.messages, "all", true);
    expect(rows.map((r) => `${r.message.title}: ${r.directions.join("+")}`)).toEqual([
      "IndexOrder: send+receive",
      "ImportBatch: receive",
    ]);
    // The sent message carries the sender's doc, whichever came first.
    const reversed = rowsOf([...queue.messages].reverse(), "all", true);
    expect(reversed[1]?.message.doc).toBe("Puts the order in the index.");
    expect(reversed[1]?.directions).toEqual(["send", "receive"]);

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRowsContent channels={[queue]} service="shop.app" kafkaUi="" grouped />
      </MemoryRouter>,
    );
    // Two rows for three messages, three chips between them.
    expect(markup.match(/<li /g)).toHaveLength(2);
    expect(markup.match(/data-direction=/g)).toHaveLength(3);
  });

  it("counts what travels each way across every channel", () => {
    expect(countDirections([queue, kafka])).toEqual({ send: 1, receive: 2 });
  });
});
