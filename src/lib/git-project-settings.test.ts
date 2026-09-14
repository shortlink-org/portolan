import { describe, expect, it } from "vitest";
import { projectGitOutput, projectGitSettings, updateGitDraftRepos } from "./git-project-settings";
import type { GitFetchState } from "./local-api";

const state: GitFetchState = {
  revision: "test", workspaceKey: "test", catalogs: [{ id: "app", title: "App" }, { id: "other", title: "Other" }], discoveryWarnings: [],
  remotes: [{ repo: "git@github.com:acme/local.git", source: "Remote", catalogs: ["app"] }],
  catalogRepositories: [
    { repo: "github.com/acme/mono", source: "Catalog", catalogs: ["app", "other"] },
    { repo: "github.com/acme/elsewhere", source: "Catalog", catalogs: ["other"] },
  ],
  entries: [{ step: 1, plugin: "git", output: "vendor/repos/other-mono", repos: [{ repo: "github.com/acme/mono", ref: "develop" }], catalogs: ["other"] }],
};
describe("project-local Git settings", () => {
  it("updates automatic cache names as the repository address is entered or replaced", () => {
    const draft = { step: null, catalog: "app", output: "vendor/repos/app-git-sources", repos: [{ repo: "" }] };
    const updated = updateGitDraftRepos(state, draft, [{ repo: "git@github.com:acme/shop.git" }]);
    expect(updated.output).toBe("vendor/repos/app-github.com-acme-shop");
    expect(updateGitDraftRepos(state, updated, [{ repo: "https://github.com/acme/shop" }]).output).toBe(updated.output);
    expect(updateGitDraftRepos(state, updated, [{ repo: "github.com/acme/api" }]).output).toBe("vendor/repos/app-github.com-acme-api");
    expect(updateGitDraftRepos(state, updated, [{ repo: "https://" }]).output).toBe(draft.output);
  });
  it("keeps saved paths fixed and assigns a new path when separating shared connections", () => {
    const draft = { step: 1, catalog: "other", output: state.entries[0]!.output, repos: state.entries[0]!.repos };
    const repos = [{ repo: "github.com/acme/new-name" }];
    expect(updateGitDraftRepos(state, draft, repos).output).toBe(draft.output);
    const shared = { ...state, entries: [{ ...state.entries[0]!, catalogs: ["app", "other"] }] };
    expect(updateGitDraftRepos(shared, draft, repos).output).toBe("vendor/repos/other-github.com-acme-new-name");
  });
  it("shows only the current project's repositories and offers other addresses separately", () => {
    const view = projectGitSettings(state, "app");
    expect(view.repositories.map((repo) => repo.identity)).toEqual(["github.com/acme/local", "github.com/acme/mono"]);
    expect(view.available.map((repo) => repo.identity)).toEqual(["github.com/acme/elsewhere"]);
    expect(view.entries).toEqual([]);
    expect(view.connected.size).toBe(0);
    expect(projectGitSettings(state, "other").connected.has("github.com/acme/mono")).toBe(true);
    expect(projectGitSettings(state, "missing").repositories).toEqual([]);
  });
  it("uses distinct output defaults across projects and avoids existing snapshots", () => {
    const output = projectGitOutput(state, "app", "github.com/acme/mono");
    expect(output).not.toBe(projectGitOutput(state, "other", "github.com/acme/mono"));
    expect(projectGitOutput({ ...state, entries: [{ ...state.entries[0]!, output }] }, "app", "github.com/acme/mono")).toBe(`${output}-2`);
  });
  it("keeps configured repositories visible before their metadata has been generated", () => {
    const view = projectGitSettings({ ...state, catalogRepositories: [] }, "other");
    expect(view.repositories.map((repo) => repo.identity)).toEqual(["github.com/acme/mono"]);
    expect(view.entries).toHaveLength(1);
  });
});
