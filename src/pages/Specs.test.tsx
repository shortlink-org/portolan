import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

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
});
