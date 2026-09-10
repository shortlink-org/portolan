import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Channel } from "../catalog";
import { ChannelRows } from "./ChannelRows";

describe("ChannelRows MessagePack presentation", () => {
  it("shows a machine-readable encoding with its declared content type", () => {
    const channel: Channel = {
      address: "inventory.snapshots",
      kind: "message",
      messages: [{
        name: "inventory.Snapshot",
        direction: "send",
        encoding: "msgpack",
        contentType: "application/msgpack",
      }],
    };
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ChannelRows channels={[channel]} service="shop.inventory" />
      </MemoryRouter>,
    );

    expect(markup).toContain('title="application/msgpack"');
    expect(markup).toContain(">msgpack</span>");
  });
});
