import { describe, expect, it } from "vitest";
import { record, run } from "./fetch-github-rfcs.mjs";

const options = {
  repo: "event-catalog/eventcatalog",
  cache: "unused",
  scope: "org",
  titlePrefix: "RFC",
  statusMap: { "needs-discussion": "discussion" },
};

describe("fetch-github-rfcs", () => {
  it("keeps the issue status and maps its lifecycle independently", () => {
    const rfc = record(
      {
        number: 2556,
        title: "RFC: Secrets as a first-class resource",
        state: "open",
        body: "## Proposed solution",
        html_url: "https://github.com/event-catalog/eventcatalog/issues/2556",
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-21T00:00:00Z",
        user: { login: "Vinceveve" },
        labels: [{ name: "needs-discussion" }],
      },
      options,
    );
    expect(rfc).toMatchObject({
      displayId: "RFC-2556",
      title: "Secrets as a first-class resource",
      status: "needs-discussion",
      lifecycle: "discussion",
      sourceKind: "github-issue",
      repository: "github.com/event-catalog/eventcatalog",
      authors: ["@Vinceveve"],
    });
  });

  it("filters ordinary issues before writing the snapshot", async () => {
    const response = await run(
      { options },
      {
        env: {},
        fetch: async () => ({
          ok: true,
          json: async () => [
            { number: 1, title: "bug", state: "open", labels: [] },
            {
              number: 2,
              title: "RFC: proposal",
              state: "open",
              labels: [],
              html_url: "https://github.com/acme/x/issues/2",
            },
          ],
        }),
      },
    );
    const fragment = JSON.parse(response.files[0].contents);
    expect(fragment.rfcs.map((rfc) => rfc.number)).toEqual(["2"]);
  });

  it("recognizes built-in status labels without configuration", () => {
    const rfc = record(
      {
        number: 7,
        title: "RFC: proposal",
        state: "open",
        labels: [{ name: "published" }],
      },
      { ...options, statusMap: {} },
    );
    expect(rfc).toMatchObject({ status: "published", lifecycle: "accepted" });
  });

  it("distinguishes a merged proposal pull request from a rejected closed one", async () => {
    const responses = [
      [
        {
          number: 9,
          title: "RFC: proposal",
          state: "closed",
          labels: [],
          pull_request: {},
          html_url: "https://github.com/acme/x/pull/9",
        },
      ],
      {
        number: 9,
        title: "RFC: proposal",
        state: "closed",
        labels: [],
        pull_request: {},
        merged_at: "2026-05-22T00:00:00Z",
        html_url: "https://github.com/acme/x/pull/9",
      },
    ];
    const response = await run(
      { options },
      {
        env: {},
        fetch: async () => ({ ok: true, json: async () => responses.shift() }),
      },
    );
    const [rfc] = JSON.parse(response.files[0].contents).rfcs;
    expect(rfc).toMatchObject({
      status: "merged",
      lifecycle: "accepted",
      sourceKind: "github-pr",
      resolvedAt: "2026-05-22T00:00:00Z",
    });
  });
});
