import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/title", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("../components/CatIllustration", () => ({ CatIllustration: () => null }));
vi.mock("../components/PluginIcon", () => ({ PluginIcon: () => null }));
const index = vi.hoisted(() => ({ empty: false }));
vi.mock("../lib/plugins", () => {
  const plugins = ["git", "eventbridge", "work-items", "openapi"].map((name) => ({
    name, plugin: name === "git" || name === "eventbridge" ? `fetch-${name}` : name,
    category: "sources", runtime: "host", phases: ["extract"], options: {}, summary: name,
  }));
  return {
    pluginIndex: plugins,
    pluginsByCategory: () => index.empty ? [] : [{ category: "sources", title: "Sources", icon: "book", what: "Source plugins", plugins }],
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

describe("plugin index empty states", () => {
  const page = (url: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><PluginIndex /></MemoryRouter>);

  it("says where the index comes from when it has no plugins", () => {
    index.empty = true;
    try {
      const html = page("/plugins");
      expect(html).toContain("The plugin index is empty.");
      expect(html).toContain("src/lib/plugin-index.json");
    } finally {
      index.empty = false;
    }
  });

  it("answers a link to a plugin the index does not have", () => {
    expect(page("/plugins#plugin-extract-cobol")).toContain("No plugin named <span class=\"mono text-ink\">extract-cobol</span> is in this index.");
    expect(page("/plugins#plugin-openapi")).not.toContain("No plugin named");
    expect(page("/plugins")).not.toContain("The plugin index is empty.");
  });
});
