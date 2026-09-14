import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskTrackerEntry } from "../../lib/task-tracker-config.mjs";

const fixture = vi.hoisted(() => ({ taskTrackers: [] as TaskTrackerEntry[] }));
vi.mock("../../data", () => ({ activeCatalogProfile: { id: "example" } }));
vi.mock("../../lib/setup-info", () => ({ setupInfo: fixture }));
vi.mock("../../routes", () => ({ paths: { pluginSettings: (name: string) => `/plugins/${name}/settings` } }));
vi.mock("../../lib/local-api", () => ({ taskTrackerSettings: vi.fn() }));
import { TaskTrackerIntegrationCard } from "./TaskTrackerIntegrationCard";

const render = (local = false) => renderToStaticMarkup(<MemoryRouter><TaskTrackerIntegrationCard local={local} /></MemoryRouter>);
beforeEach(() => { fixture.taskTrackers = []; });

describe("task tracker integration summary", () => {
  it("shows supported brands and a catalog-preserving link, without the editor", () => {
    const html = render();
    expect(html).toContain("not configured");
    for (const label of ["YouTrack", "Jira", "Linear", "GitHub Issues", "GitLab Issues"]) expect(html).toContain(label);
    expect(html).toContain('/plugins/work-items/settings?catalog=example');
    expect(html).not.toMatch(/<input|<textarea|<select/);
  });
  it("counts enabled repositories and deduplicates their provider labels", () => {
    const tracker = { id: "team", provider: "jira" as const, baseUrl: "https://team.atlassian.net", projects: ["RT"] };
    fixture.taskTrackers = [0, 1, 2].map((step) => ({ step, input: String(step), output: "out", file: "tasks.json", maxCommits: 500, trackers: step === 2 ? [] : [tracker] }));
    const html = render();
    expect(html).toContain("2 repositories");
    expect(html.match(/>Jira</g)).toHaveLength(1);
    expect(html).not.toContain("GitLab Issues");
  });
  it("does not present stale build-time configuration as current local settings", () => {
    expect(render(true)).toContain("loading");
    expect(render(true)).toContain("Configure task trackers");
  });
});
