import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/local-api", () => ({ checkGitRepositoryAccess: vi.fn() }));
import { mergeGitRepositories } from "../../lib/git-fetch-config.mjs";
import { ProjectRepositories, RepositoryAccessStatus } from "./ProjectRepositories";
import { rememberGitAccess } from "../../lib/git-access-memory";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

const repositories = mergeGitRepositories([{ repo: "github.com/acme/shop", source: "Catalog · Shop" }]);
const render = (connected = new Set<string>(), rows = repositories) => renderToStaticMarkup(<ProjectRepositories workspaceKey="test" repositories={rows} connected={connected} disabled={false} onConnect={vi.fn()} onManual={vi.fn()} />);
describe("project repository discovery", () => {
  it("keeps repositories from other projects in a collapsed, inert picker", () => {
    const available = mergeGitRepositories([{ repo: "github.com/acme/other", source: "Elsewhere" }]);
    const html = renderToStaticMarkup(<ProjectRepositories workspaceKey="test" projectTitle="App" repositories={repositories} available={available} connected={new Set()} disabled={false} onConnect={vi.fn()} onManual={vi.fn()} />);
    expect(html).toContain("Connect existing");
    expect(html).toContain('aria-label="Current project repositories"');
    expect(html).toContain("github.com/acme/shop");
    expect(html).toMatch(/aria-label="Connect an existing repository" aria-hidden="true" inert=""/);
    expect(html).not.toContain("Catalog scope");
  });
  it("restores the saved transport, status and timestamp when the row mounts again", () => {
    rememberGitAccess("test", repositories[0]!.identity, "ssh", { url: repositories[0]!.urls.ssh!, result: { status: "accessible", message: "No files downloaded.", checkedAt: "2026-09-14T07:00:00.000Z" } });
    const html = render();
    expect(html).toContain('aria-label="Transport for github.com/acme/shop"');
    expect(html).toContain('>SSH</span>');
    expect(html).toContain("Read access confirmed");
    expect(html).toContain("Last checked:");
    expect(html).toContain('dateTime="2026-09-14T07:00:00.000Z"');
    expect(html).toContain('aria-label="Last checked:');
    expect(html).toContain('<time class="sr-only"');
    expect(html).toContain('lucide-clock-3');
    expect(html).toContain('hover:bg-accent/10');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("Not checked");
  });
  it("pairs access colors with explicit labels and hides stale results during rechecks", () => {
    const success = renderToStaticMarkup(<RepositoryAccessStatus result={{ status: "accessible", message: "No files downloaded." }} />);
    expect(success).toContain("text-verified");
    expect(success).toContain("Read access confirmed");
    expect(success).toContain('role="status"');
    const failure = renderToStaticMarkup(<RepositoryAccessStatus result={{ status: "unavailable", message: "Check your SSH agent." }} />);
    expect(failure).toContain("text-unresolved");
    expect(failure).toContain("Access check failed");
    expect(failure).toContain("Check your SSH agent.");
    const pending = renderToStaticMarkup(<RepositoryAccessStatus checking result={{ status: "accessible", message: "Old success", checkedAt: "2026-09-14T07:00:00.000Z" }} />);
    expect(pending).toContain("text-accent");
    expect(pending).toContain("motion-safe:animate-spin");
    expect(pending).not.toContain("Old success");
    expect(pending).not.toContain("Read access confirmed");
    expect(pending).not.toContain("Last checked");
    expect(renderToStaticMarkup(<RepositoryAccessStatus />)).toContain("Not checked");
    expect(render()).toContain("border-l-line-strong");
    expect(render()).toContain("border-l-4 bg-surface");
  });
  it("omits source-label clutter while keeping transport and explicit access and connect actions", () => {
    const html = render();
    expect(html).toContain("Project repositories");
    expect(html).toContain("Repositories known to this project");
    expect(html).not.toContain("Catalog · Shop");
    expect(html).toContain("Transport for github.com/acme/shop");
    expect(html).toContain(">HTTPS</span>");
    expect(html).not.toContain("<select");
    expect(html).toContain("Check access");
    expect(html).toContain("Edit<span");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Connect</button>");
    expect(html).toContain("Access not checked");
    expect(html).toContain("Add repository by URL");
  });
  it("distinguishes configured repositories from checked access and supports empty discovery", () => {
    const html = render(new Set([repositories[0]!.identity]));
    expect(html).toContain("Configured");
    expect(html).toContain("Access not checked");
    expect(html).toMatch(/disabled=""[^>]*><svg[^]*Edit<span/);
    expect(render(new Set(), [])).toContain("No supported repository addresses found");
  });
  it("keeps the editor inside its own card and mounted when collapsed", () => {
    const rows = mergeGitRepositories([{ repo: "github.com/acme/shop", source: "Catalog" }, { repo: "github.com/acme/api", source: "Catalog" }]);
    for (const expanded of [true, false]) {
      const html = renderToStaticMarkup(<ProjectRepositories workspaceKey="test" repositories={rows} connected={new Set()} disabled activeRepository="github.com/acme/shop" expanded={expanded} editor={<input aria-label="Draft branch" defaultValue="draft-ref" />} onToggle={vi.fn()} onConnect={vi.fn()} onManual={vi.fn()} />);
      const cards = html.match(/<li\b[^]*?<\/li>/g)!;
      const active = cards.find((card) => card.includes('Settings for github.com/acme/shop'))!;
      const other = cards.find((card) => card.includes('Settings for github.com/acme/api'))!;
      expect(active).toContain('aria-label="Draft branch"');
      expect(other).not.toContain('aria-label="Draft branch"');
      expect(active).toContain(`aria-expanded="${expanded}"`);
      expect(active).toContain(`aria-label="Settings for github.com/acme/shop" aria-hidden="${!expanded}"`);
      if (!expanded) expect(active).toContain('inert=""');
      expect(active).not.toMatch(/aria-controls="[^"]*" disabled/);
      expect(other).toMatch(/aria-controls="[^"]*" disabled/);
    }
  });
});
