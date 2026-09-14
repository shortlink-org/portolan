import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/title", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("../components/CatIllustration", () => ({ CatIllustration: () => null }));
vi.mock("../components/PluginIcon", () => ({ PluginIcon: () => null }));
vi.mock("../lib/plugins", () => {
  const plugins = ["git", "eventbridge", "work-items", "openapi"].map((name) => ({
    name, plugin: name === "git" || name === "eventbridge" ? `fetch-${name}` : name,
    category: "sources", runtime: "host", phases: ["extract"], options: {}, summary: name,
  }));
  return {
    pluginIndex: plugins,
    pluginsByCategory: () => [{ category: "sources", title: "Sources", icon: "book", what: "Source plugins", plugins }],
    pluginIcon: () => ({}), pluginLabel: (name: string) => name,
    pluginSourceHref: () => "https://example.com/source", runtimeLabel: () => "host",
  };
});
import { PluginIndex } from "./PluginIndex";

describe("plugin card settings action", () => {
  it("places an accessible icon-only settings link in each supported card header", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/plugins?catalog=portolan"]}><PluginIndex /></MemoryRouter>);
    for (const name of ["git", "eventbridge", "work-items"]) {
      const card = html.split(`id="plugin-${name}"`)[1]!.split("</article>")[0]!;
      const header = card.split("</header>")[0]!;
      expect(header).toContain(`href="/plugins/${name}/settings?catalog=portolan"`);
      expect(header).toContain(`aria-label="${name} settings"`);
      expect(header).toContain('title="Plugin settings"');
      expect(card).not.toContain(">Plugin settings</a>");
    }
    expect(html).not.toContain('aria-label="openapi settings"');
  });
});
