import { describe, expect, it } from "vitest";
import { createIntegrationStore, normalizeIntegrationUrl } from "./integration-url";

describe("integration URLs", () => {
  it("accepts web URLs and rejects values that cannot be opened safely", () => {
    expect(normalizeIntegrationUrl(" https://docs.example/ ")).toBe(
      "https://docs.example",
    );
    expect(normalizeIntegrationUrl("https://docs.example/wiki#top")).toBe(
      "https://docs.example/wiki",
    );
    expect(normalizeIntegrationUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeIntegrationUrl("not a URL")).toBeNull();
    expect(normalizeIntegrationUrl("  ")).toBe("");
  });

  it("keeps a normalized value and ignores one that cannot be opened", () => {
    // vitest runs under node, so the store keeps the value for this session
    // only; what is asserted is the behaviour the page sees either way.
    const store = createIntegrationStore("portolan.integrations.test");
    store.getState().setUrl("https://docs.example/");
    expect(store.getState().url).toBe("https://docs.example");

    store.getState().setUrl("javascript:alert(1)");
    expect(store.getState().url).toBe("https://docs.example");

    store.getState().setUrl("");
    expect(store.getState().url).toBe("");
  });
});
