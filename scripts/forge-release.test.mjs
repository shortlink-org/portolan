import { describe, expect, it } from "vitest";

import { CLOSE, OPEN, forgeFromEnv, splice, upsert } from "./forge-release.mjs";

describe("forgeFromEnv", () => {
  it("reads the tag off a GitHub tag push, or takes the one it is given", () => {
    const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "acme/shop", GITHUB_TOKEN: "t", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.2.0" };

    expect(forgeFromEnv(env)).toMatchObject({ provider: "github", tag: "v1.2.0", token: "t" });
    expect(forgeFromEnv({ ...env, GITHUB_REF_TYPE: "branch", GITHUB_REF: "refs/tags/v2.0.0" })).toMatchObject({ tag: "v2.0.0" });
    expect(forgeFromEnv(env, "v3.0.0")).toMatchObject({ tag: "v3.0.0" });
  });

  it("says why on a branch push, or without a token", () => {
    expect(forgeFromEnv({ GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main", GITHUB_TOKEN: "t" })).toEqual({ reason: "not a tag" });
    expect(forgeFromEnv({ GITHUB_ACTIONS: "true", GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1" })).toEqual({ reason: "GITHUB_TOKEN is not set" });
    expect(forgeFromEnv({ GITLAB_CI: "true", CI_API_V4_URL: "x", CI_COMMIT_TAG: "v1" })).toEqual({ reason: "PORTOLAN_TOKEN is not set" });
    expect(forgeFromEnv({})).toEqual({ reason: "not running under GitHub Actions or GitLab CI" });
  });

  it("reads a GitLab tag pipeline with the project token", () => {
    expect(forgeFromEnv({ GITLAB_CI: "true", CI_API_V4_URL: "https://gitlab.example.com/api/v4/", CI_PROJECT_ID: "12", CI_COMMIT_TAG: "v1.0.0", PORTOLAN_TOKEN: "p" }))
      .toEqual({ provider: "gitlab", api: "https://gitlab.example.com/api/v4", project: "12", token: "p", tag: "v1.0.0" });
  });
});

describe("splice", () => {
  const report = "### Architecture, against `v1.1.0`\n\n2 changes.\n";

  it("appends the section to notes that do not have one, and starts empty notes with it", () => {
    expect(splice("## What's Changed\n- fix\n", report)).toBe(
      "## What's Changed\n- fix\n\n" + OPEN + "\n" + report.trimEnd() + "\n" + CLOSE + "\n",
    );
    expect(splice("", report)).toBe(OPEN + "\n" + report.trimEnd() + "\n" + CLOSE + "\n");
  });

  // The rest of the body is somebody else's, and a second run must touch
  // nothing but the part between the markers.
  it("replaces its own section in place and leaves the rest alone", () => {
    const before = "intro\n\n" + OPEN + "\nold\n" + CLOSE + "\n\noutro\n";

    expect(splice(before, "new")).toBe("intro\n\n" + OPEN + "\nnew\n" + CLOSE + "\n\noutro\n");
  });
});

describe("upsert", () => {
  const github = { provider: "github", api: "https://api.github.com", repo: "acme/shop", token: "t", tag: "v1.2.0" };
  const gitlab = { provider: "gitlab", api: "https://gitlab.example.com/api/v4", project: "grp/shop", token: "p", tag: "v1.2.0" };

  function fake(answers) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
      const answer = answers.shift();

      return { ok: answer.status < 400, status: answer.status, statusText: "", json: async () => answer.json, text: async () => "" };
    };

    return { fetchImpl, calls };
  }

  it("creates a release named after the tag when there is none", async () => {
    const { fetchImpl, calls } = fake([{ status: 404, json: {} }, { status: 201, json: { html_url: "https://github.com/acme/shop/releases/tag/v1.2.0" } }]);

    const done = await upsert(github, "report", fetchImpl);

    expect(done).toEqual({ outcome: "created", url: "https://github.com/acme/shop/releases/tag/v1.2.0" });
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/shop/releases/tags/v1.2.0");
    expect(calls[1]).toMatchObject({
      method: "POST", url: "https://api.github.com/repos/acme/shop/releases",
      body: { tag_name: "v1.2.0", name: "v1.2.0", body: OPEN + "\nreport\n" + CLOSE + "\n" },
    });
  });

  it("updates the body of a release that exists, keeping what was there", async () => {
    const { fetchImpl, calls } = fake([
      { status: 200, json: { id: 9, body: "notes\n" } },
      { status: 200, json: { html_url: "u" } },
    ]);

    const done = await upsert(github, "report", fetchImpl);

    expect(done.outcome).toBe("updated");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://api.github.com/repos/acme/shop/releases/9" });
    expect(calls[1].body.body).toBe("notes\n\n" + OPEN + "\nreport\n" + CLOSE + "\n");
  });

  it("speaks GitLab releases by tag, with the description field", async () => {
    const { fetchImpl, calls } = fake([
      { status: 200, json: { description: "" } },
      { status: 200, json: { _links: { self: "https://gitlab.example.com/grp/shop/-/releases/v1.2.0" } } },
    ]);

    const done = await upsert(gitlab, "report", fetchImpl);

    expect(calls[0].url).toBe("https://gitlab.example.com/api/v4/projects/grp%2Fshop/releases/v1.2.0");
    expect(calls[1]).toMatchObject({ method: "PUT", url: "https://gitlab.example.com/api/v4/projects/grp%2Fshop/releases/v1.2.0" });
    expect(calls[1].body.description).toBe(OPEN + "\nreport\n" + CLOSE + "\n");
    expect(done.url).toBe("https://gitlab.example.com/grp/shop/-/releases/v1.2.0");
  });

  it("reports a refusal rather than throwing, and throws on anything else", async () => {
    expect(await upsert(github, "r", fake([{ status: 403, json: {} }]).fetchImpl)).toEqual({ outcome: "refused", status: 403 });
    await expect(upsert(github, "r", fake([{ status: 500, json: {} }]).fetchImpl)).rejects.toThrow("read release: 500");
  });
});
