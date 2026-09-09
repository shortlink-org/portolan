import { describe, expect, it } from "vitest";

import { buildIndex } from "../catalog";
import type { Catalog, Flow } from "../catalog";
import { flowAnswers, stepAnswer } from "./answers";

describe("explicit flow responses", () => {
  it("moves the contract answer off a request that has a response step", () => {
    const flow: Flow = {
      id: "flow.get-book",
      slug: "get-book",
      name: "Get book",
      summary: "",
      owner: "demo",
      participants: [
        { id: "demo.api", kind: "service", context: "demo" },
        { id: "demo.book", kind: "service", context: "demo" },
      ],
      steps: [
        {
          type: "step",
          id: "request",
          from: "demo.api",
          to: "demo.book",
          kind: "rpc",
          ref: "book.v1.Book/Get",
          label: "Get",
          status: "declared",
        },
        {
          type: "step",
          id: "response",
          from: "demo.book",
          to: "demo.api",
          kind: "response",
          label: "GetResponse",
          status: "declared",
          replyTo: "request",
        },
      ],
    };
    const catalog: Catalog = {
      generatedAt: "2026-09-09T00:00:00Z",
      commit: "0000000",
      contexts: [
        {
          id: "demo",
          slug: "demo",
          name: "Demo",
          summary: "",
          services: [
            {
              id: "demo.api",
              slug: "api",
              name: "API",
              repo: "",
              path: "",
              readme: "",
              provides: [],
              consumes: [],
              aggregates: [],
            },
            {
              id: "demo.book",
              slug: "book",
              name: "Book",
              repo: "",
              path: "",
              readme: "",
              provides: [
                {
                  id: "book.v1.Book",
                  source: "book.proto",
                  methods: [
                    {
                      name: "Get",
                      request: "GetRequest",
                      response: "GetResponse",
                    },
                  ],
                },
              ],
              consumes: [],
              aggregates: [],
            },
          ],
        },
      ],
      defs: {},
      flows: [flow],
      adrs: [],
    };
    const index = buildIndex(catalog);
    const request = flow.steps[0];
    if (request?.type !== "step") throw new Error("missing request");

    expect(stepAnswer(index, request)).toBe("GetResponse");
    expect(flowAnswers(index, flow).has(request.id)).toBe(false);
  });
});
