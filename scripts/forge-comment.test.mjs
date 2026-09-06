import { describe, expect, it } from "vitest";

import { MARKER, body, findOwn, forgeFromEnv, upsert } from "./forge-comment.mjs";

describe("forgeFromEnv", () => {
  it("reads a GitHub pull request off the event payload", () => {
    const forge = forgeFromEnv(
      { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "acme/shop", GITHUB_TOKEN: "t" },
      { pull_request: { number: 42 } },
    );

    expect(forge).toEqual({
      provider: "github", api: "https://api.github.com", repo: "acme/shop", number: 42, token: "t",
    });
  });

  // A workflow_run or a re-run has no event body worth reading, but the ref
  // of a pull request checkout still names it.
  it("falls back to the merge ref when there is no event", () => {
    const forge = forgeFromEnv({
      GITHUB_REPOSITORY: "acme/shop", GITHUB_TOKEN: "t", GITHUB_REF: "refs/pull/7/merge",
      GITHUB_API_URL: "https://ghe.example.com/api/v3/",
    });

    expect(forge).toMatchObject({ provider: "github", number: 7, api: "https://ghe.example.com/api/v3" });
  });

  it("says why when a push is not a pull request, or the token is missing", () => {
    expect(forgeFromEnv({ GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" })).toEqual({ reason: "not a pull request" });
    expect(forgeFromEnv({ GITHUB_ACTIONS: "true" }, { pull_request: { number: 1 } })).toEqual({ reason: "GITHUB_TOKEN is not set" });
  });

  it("reads a GitLab merge request, with the project token rather than the job's", () => {
    const forge = forgeFromEnv({
      GITLAB_CI: "true", CI_API_V4_URL: "https://gitlab.example.com/api/v4", CI_PROJECT_ID: "12",
      CI_MERGE_REQUEST_IID: "9", CI_JOB_TOKEN: "job", PORTOLAN_TOKEN: "p",
    });

    expect(forge).toEqual({
      provider: "gitlab", api: "https://gitlab.example.com/api/v4", project: "12", number: 9, token: "p",
    });
    expect(forgeFromEnv({ GITLAB_CI: "true", CI_API_V4_URL: "x", CI_MERGE_REQUEST_IID: "9" })).toEqual({ reason: "PORTOLAN_TOKEN is not set" });
    expect(forgeFromEnv({ GITLAB_CI: "true", CI_API_V4_URL: "x" })).toEqual({ reason: "not a merge request pipeline" });
  });

  it("has nothing to say on a laptop", () => {
    expect(forgeFromEnv({})).toEqual({ reason: "not running under GitHub Actions or GitLab CI" });
  });
});

describe("the comment", () => {
  it("starts with the marker and is found by it", () => {
    const text = body("### Architecture\n\n1 change.\n");

    expect(text.startsWith(MARKER + "\n")).toBe(true);
    expect(findOwn([{ id: 1, body: "lgtm" }, { id: 2, body: text }])).toMatchObject({ id: 2 });
    expect(findOwn([{ id: 1, body: "lgtm" }])).toBeNull();
  });
});

describe("upsert", () => {
  const github = { provider: "github", api: "https://api.github.com", repo: "acme/shop", number: 42, token: "t" };
  const gitlab = { provider: "gitlab", api: "https://gitlab.example.com/api/v4", project: "grp/shop", number: 9, token: "p" };

  /** A fetch that answers from a script and records what it was asked. */
  function fake(answers) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
      const answer = answers.shift();

      return {
        ok: answer.status < 400, status: answer.status, statusText: "",
        json: async () => answer.json, text: async () => "",
      };
    };

    return { fetchImpl, calls };
  }

  it("creates a comment when it has not written one", async () => {
    const { fetchImpl, calls } = fake([
      { status: 200, json: [{ id: 1, body: "lgtm" }] },
      { status: 201, json: { html_url: "https://github.com/acme/shop/pull/42#issuecomment-5" } },
    ]);

    const done = await upsert(github, "report", fetchImpl);

    expect(done).toEqual({ outcome: "created", url: "https://github.com/acme/shop/pull/42#issuecomment-5" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/repos/acme/shop/issues/42/comments",
      body: { body: MARKER + "\nreport\n" },
    });
    expect(calls[1].headers.authorization).toBe("Bearer t");
  });

  it("updates the comment it wrote last time, on the comment's own route", async () => {
    const { fetchImpl, calls } = fake([
      { status: 200, json: [{ id: 3, body: MARKER + "\nold\n" }] },
      { status: 200, json: { html_url: "u" } },
    ]);

    const done = await upsert(github, "new", fetchImpl);

    expect(done.outcome).toBe("updated");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://api.github.com/repos/acme/shop/issues/comments/3" });
  });

  it("keeps listing past a full page before deciding there is none", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: i, body: "x" }));
    const { fetchImpl, calls } = fake([
      { status: 200, json: page },
      { status: 200, json: [{ id: 200, body: MARKER + "\nold\n" }] },
      { status: 200, json: {} },
    ]);

    await upsert(github, "new", fetchImpl);

    expect(calls[0].url).toContain("page=1");
    expect(calls[1].url).toContain("page=2");
    expect(calls[2]).toMatchObject({ method: "PATCH" });
  });

  it("speaks GitLab notes with the project path encoded", async () => {
    const { fetchImpl, calls } = fake([
      { status: 200, json: [{ id: 8, body: MARKER + "\nold\n" }] },
      { status: 200, json: {} },
    ]);

    await upsert(gitlab, "new", fetchImpl);

    expect(calls[0].url).toBe("https://gitlab.example.com/api/v4/projects/grp%2Fshop/merge_requests/9/notes?per_page=100&page=1");
    expect(calls[0].headers["private-token"]).toBe("p");
    expect(calls[1]).toMatchObject({ method: "PUT", url: "https://gitlab.example.com/api/v4/projects/grp%2Fshop/merge_requests/9/notes/8" });
  });

  // A fork's GITHUB_TOKEN can read the comments and not write one. That is
  // the forge's policy, not a broken setup, and the step stays green.
  it("reports a refusal rather than throwing", async () => {
    const { fetchImpl } = fake([{ status: 200, json: [] }, { status: 403, json: {} }]);

    expect(await upsert(github, "r", fetchImpl)).toEqual({ outcome: "refused", status: 403 });
  });

  it("throws on any other failure", async () => {
    const { fetchImpl } = fake([{ status: 500, json: {} }]);

    await expect(upsert(github, "r", fetchImpl)).rejects.toThrow("list comments: 500");
  });
});
