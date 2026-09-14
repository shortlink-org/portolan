import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { TaskTrackerState } from "../../lib/local-api";
vi.mock("../../lib/plugins", () => ({ pluginIndex: [{ name: "git-source", plugin: "fetch-git" }] }));
vi.mock("../../routes", () => ({ paths: { plugins: () => "/plugins", pluginSettings: (name: string) => `/plugins/${name}/settings`, settingsProjects: () => "/settings/projects" } }));
import { WorkItemGitRequirement } from "./WorkItemGitRequirement";

const render = (repositories?: TaskTrackerState["repositories"], local = true) => renderToStaticMarkup(<MemoryRouter><WorkItemGitRequirement local={local} repositories={repositories} catalog="example" /></MemoryRouter>);
describe("Git history requirement", () => {
  it("distinguishes required history from the related snapshot plugin and uses its registered name", () => {
    const html = render([{ input: ".", label: "Workspace", available: true }]);
    expect(html).toContain("1 checkout available");
    expect(html).toContain("source snapshots only");
    expect(html).toContain("does not satisfy this requirement by itself");
    expect(html).toContain('/plugins/git-source/settings?catalog=example');
    expect(html).toContain('/settings/projects?catalog=example');
  });
  it("explains unavailable roots and incomplete shallow history", () => {
    const html = render([{ input: "vendor/app", label: "App", available: false, reason: "Source snapshot, not a checkout." }, { input: "repo", label: "Repo", available: true, shallow: true }]);
    expect(html).toContain("1 unavailable");
    expect(html).toContain("Source snapshot, not a checkout.");
    expect(html).toContain("shallow history");
    expect(html).toContain("Full scan cannot restore missing history");
  });
  it("does not claim local history is present in published or unchecked catalogs", () => {
    expect(render(undefined, false)).toContain("checked locally");
    expect(render()).toContain("not checked");
    expect(render(undefined, false)).not.toContain("0 checkouts available");
    expect(render([])).toContain("0 checkouts available");
  });
});
