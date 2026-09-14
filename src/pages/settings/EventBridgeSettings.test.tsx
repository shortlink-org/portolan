import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../data", () => ({ activeCatalogProfile: { id: "example" } }));
vi.mock("../../app/toast", () => ({ useToastStore: () => vi.fn() }));
vi.mock("../../lib/local-api", () => ({ eventBridgeSettings: vi.fn(), saveEventBridge: vi.fn(), subscribeToRun: vi.fn() }));
import { EventBridgeSettings } from "./EventBridgeSettings";

describe("EventBridge plugin settings", () => {
  it("keeps AWS credentials out of the published configuration surface", () => {
    const html = renderToStaticMarkup(<EventBridgeSettings local={false} />);
    expect(html).toContain("AWS authentication stays outside Portolan");
    expect(html).toContain("standard AWS SDK credential chain");
    expect(html).toContain("never asks for or stores access keys");
    expect(html).toContain("Copy starter step");
    expect(html).not.toContain('name="accessKey');
    expect(html).not.toContain('name="secret');
  });

  it("loads persisted project configuration only for a local project", () => {
    const html = renderToStaticMarkup(<EventBridgeSettings local />);
    expect(html).toContain("Loading EventBridge configuration");
    expect(html).toContain("project configuration");
    expect(html).not.toContain("Copy starter step");
  });
});
