import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ChangeSpec } from "../catalog";
import { SpecDetailView } from "./SpecDetail";
import { SpecIndexView } from "./SpecIndex";

const spec: ChangeSpec = {
  id: "deliver-local-auction-mvp",
  slug: "deliver-local-auction-mvp",
  title: "Deliver local auction MVP",
  format: "openspec",
  lifecycle: "implementing",
  source: "openspec/changes/deliver-local-auction-mvp",
  artifacts: [
    { kind: "proposal", path: "proposal.md", body: "## Why\nShip locally." },
    { kind: "design", path: "design.md", body: "## Decisions\nUse SQLite." },
  ],
  requirements: [
    {
      id: "auction:create",
      title: "Create an auction",
      text: "The system SHALL create a local auction.",
      source: "specs/auction/spec.md:3",
      scenarios: [
        {
          name: "Seller creates an auction",
          when: ["the seller submits a valid lot"],
          then: ["the auction is visible locally"],
        },
      ],
    },
  ],
  tasks: [
    { id: "1.1", title: "Create auction storage", done: true, source: "tasks.md:3" },
    { id: "1.2", title: "Add auction UI", done: false, source: "tasks.md:4" },
  ],
};

const render = (node: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
};

describe("spec pages", () => {
  it("summarizes lifecycle and checklist progress without calling it implementation evidence", () => {
    const html = render(<SpecIndexView specs={[spec]} />);
    expect(html).toContain("Deliver local auction MVP");
    expect(html).toContain("1 of 2 tasks");
    expect(html).toContain("implementation evidence is tracked separately");
    expect(html).toContain('/specs/deliver-local-auction-mvp');
  });

  it("renders source requirements, scenarios, artifacts, and checklist state", () => {
    const html = render(<SpecDetailView spec={spec} />);
    expect(html).toContain("Create an auction");
    expect(html).toContain("Seller creates an auction");
    expect(html).toContain("the seller submits a valid lot");
    expect(html).toContain("the auction is visible locally");
    expect(html).toContain("Create auction storage");
    expect(html).toContain("proposal.md");
    expect(html).toContain("design.md");
    expect(html).toContain("Checklist progress is author intent");
  });

  it("shows branch path impact as changed with rather than implementation evidence", () => {
    const html = render(<SpecDetailView spec={spec} impact={[
      { path: "src/auction.ts", repository: "github.com/acme/auction", level: "repository", reason: "unmatched" },
    ]} />);
    expect(html).toContain("Changed with");
    expect(html).toContain("src/auction.ts");
    expect(html).toContain("path.impact");
    expect(html).not.toContain("implements");
  });

  it("projects Git, lifecycle, task and path evidence into one activity timeline", () => {
    const previous = { ...spec, lifecycle: "planned" as const, tasks: spec.tasks.map((task) => ({ ...task, done: false })) };
    const html = render(<SpecDetailView
      spec={spec}
      previous={previous}
      history={[{ source: "tasks.md", status: "available", repository: "https://github.com/acme/repo", first: { commit: "abc1234", author: "Ada", date: "2026-01-01T00:00:00Z" }, latest: { commit: "def5678", author: "Lin", date: "2026-02-01T00:00:00Z" } }]}
      impact={[{ path: "src/auction.ts", repository: "acme/repo", level: "repository", reason: "unmatched" }]}
    />);
    expect(html).toContain("Git history");
    expect(html).toContain("Catalog diff");
    expect(html).toContain("Changed with");
    expect(html).toContain("spec.lifecycle");
    expect(html).toContain("task.completed");
    expect(html).toContain("tasks.md was changed in def5678 by Lin");
    expect(html).toContain("#spec-task-1.1");
  });

  it("links exact references, leaves similar names as prose, and lists broken exact references", () => {
    const linked: ChangeSpec = {
      ...spec,
      artifacts: [
        {
          kind: "proposal",
          path: "proposal.md",
          body: "Exact `portolan.host`; source `proposal.md`; requirement `auction:create`; task `1.2`; broken `missing/file.ts:9`. Portolan host stays prose.",
        },
        { kind: "design", path: "design.md", body: "Design for `portolan.host`." },
      ],
      requirements: [{
        ...spec.requirements[0]!,
        title: "`portolan.host` requirement",
        text: "The exact owner is `portolan.host`.",
        scenarios: [{ name: "`portolan.host` scenario", when: ["`portolan.host` changes"], then: ["open `portolan.host`"] }],
      }],
      tasks: spec.tasks.map((task) => task.id === "1.2" ? { ...task, title: "Update `portolan.host`" } : task),
    };
    const html = render(<SpecDetailView spec={linked} />);
    expect(html.match(/href="\/c\/portolan\/host"/g)).toHaveLength(8);
    expect(html).toContain(`href="#spec-requirement-${encodeURIComponent("auction:create")}"`);
    expect(html).toContain('href="#spec-task-1.2"');
    expect(html).toContain("Portolan host stays prose.");
    expect(html).not.toContain(">Portolan host</a>");
    expect(html).toContain("Unresolved references");
    expect(html).toContain("missing/file.ts:9");
  });
});
