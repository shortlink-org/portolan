import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ isSuccess: true, isPending: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));
vi.mock("../lib/queries", () => ({ localStatusQuery: () => ({}) }));
vi.mock("../app/title", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("../routes", () => ({ paths: { plugins: () => "/plugins" } }));
vi.mock("../lib/plugins", () => ({
  pluginByName: (name: string) => ["work-items", "openapi", "eventbridge"].includes(name) ? { category: "evidence", plugin: name === "eventbridge" ? "fetch-eventbridge" : name } : undefined,
  pluginLabel: (name: string) => name,
  pluginIcon: () => ({ lucide: "book" }),
}));
vi.mock("../components/PluginIcon", () => ({ PluginIcon: () => null }));
vi.mock("./settings/TaskTrackerSettings", () => ({ TaskTrackerSettings: ({ local }: { local: boolean }) => <div>{local ? "editable tracker form" : "read-only tracker form"}</div> }));
vi.mock("./settings/EventBridgeSettings", () => ({ EventBridgeSettings: ({ local }: { local: boolean }) => <div>{local ? "editable EventBridge form" : "read-only EventBridge form"}</div> }));
import { PluginSettings } from "./PluginSettings";

const render = (name = "work-items") => renderToStaticMarkup(<MemoryRouter initialEntries={[`/plugins/${name}/settings?catalog=example`]}><Routes><Route path="/plugins/:name/settings" element={<PluginSettings />} /></Routes></MemoryRouter>);
beforeEach(() => { query.isSuccess = true; query.isPending = false; });

describe("plugin settings route", () => {
  it("renders plugin-owned settings and preserves the catalog in its back link", () => {
    const html = render();
    expect(html).toContain("editable tracker form");
    expect(html).toContain('/plugins?catalog=example#plugin-work-items');
    expect(html).not.toContain("Settings sections");
    expect(html).not.toContain("/settings/");
  });
  it("waits for local capability detection and supports published read-only catalogs", () => {
    query.isPending = true;
    expect(render()).toContain("Loading plugin settings");
    expect(render()).not.toContain("tracker form");
    query.isPending = false; query.isSuccess = false;
    expect(render()).toContain("read-only tracker form");
  });
  it("does not show tracker settings for unknown or unrelated plugins", () => {
    expect(render("missing")).toContain("Plugin not found");
    expect(render("openapi")).toContain("no dedicated settings page");
    expect(render("missing")).not.toContain("tracker form");
    expect(render("openapi")).not.toContain("tracker form");
  });
  it("renders EventBridge settings through the plugin-owned route", () => {
    expect(render("eventbridge")).toContain("editable EventBridge form");
    query.isSuccess = false;
    expect(render("eventbridge")).toContain("read-only EventBridge form");
  });
});
