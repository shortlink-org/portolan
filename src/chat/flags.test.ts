import { describe, expect, it } from "vitest";
import { chatRoute, ownReady, parsePrefs, routeLabel } from "./flags";
import type { ChatBuild, OwnModel } from "./flags";

const withProxy: ChatBuild = { built: true, proxyUrl: "https://x.workers.dev/chat" };
const noProxy: ChatBuild = { built: true, proxyUrl: "" };
const notBuilt: ChatBuild = { built: false, proxyUrl: "https://x.workers.dev/chat" };
const own: OwnModel = { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "llama" };

describe("chatRoute", () => {
  it("is off when the build has no chat, whatever the reader set", () => {
    expect(chatRoute(notBuilt, { enabled: true, own })).toEqual({ kind: "off" });
  });

  it("is off when the reader switched it off, even with a proxy and a key", () => {
    expect(chatRoute(withProxy, { enabled: false, own })).toEqual({ kind: "off" });
  });

  it("uses the proxy by default when the build has one", () => {
    expect(chatRoute(withProxy, { enabled: null, own: null })).toEqual({
      kind: "proxy",
      url: withProxy.proxyUrl,
    });
  });

  it("prefers the reader's own model over the proxy", () => {
    expect(chatRoute(withProxy, { enabled: null, own })).toEqual({ kind: "own", model: own });
  });

  it("stays off without a proxy until switched on, then asks to be configured", () => {
    expect(chatRoute(noProxy, { enabled: null, own: null })).toEqual({ kind: "off" });
    expect(chatRoute(noProxy, { enabled: true, own: null })).toEqual({ kind: "unconfigured" });
  });

  it("does not count a half-filled model as one", () => {
    expect(ownReady({ baseUrl: "", apiKey: "k", model: "m" })).toBe(false);
    expect(ownReady({ baseUrl: "https://a", apiKey: "", model: "m" })).toBe(true);
    expect(chatRoute(noProxy, { enabled: true, own: { baseUrl: "https://a", apiKey: "", model: " " } })).toEqual({ kind: "unconfigured" });
  });
});

describe("routeLabel", () => {
  it("names the model and the host, or the proxy", () => {
    expect(routeLabel({ kind: "own", model: own })).toBe("llama · api.groq.com");
    expect(routeLabel({ kind: "proxy", url: "u" })).toBe("demo proxy");
    expect(routeLabel({ kind: "off" })).toBe("");
  });
});

describe("parsePrefs", () => {
  it("reads the switch and the model, and shrugs at junk", () => {
    expect(parsePrefs("on", null)).toEqual({ enabled: true, own: null });
    expect(parsePrefs("off", "{bad json")).toEqual({ enabled: false, own: null });
    expect(parsePrefs(null, JSON.stringify({ baseUrl: "https://a", model: "m" }))).toEqual({
      enabled: null,
      own: { baseUrl: "https://a", apiKey: "", model: "m" },
    });
  });
});
