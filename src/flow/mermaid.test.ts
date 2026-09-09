import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flow } from "../catalog";
import { catalog, index } from "../data";
import { flowAnswers } from "./answers";
import { flowMermaid } from "./mermaid";

/** The fenced mermaid block of a generated flow page. */
function generated(slug: string): string {
  const page = readFileSync(`docs/flows/${slug}.md`, "utf8");
  const match = /```mermaid\n([\s\S]*?)```/.exec(page);
  if (!match) throw new Error(`no mermaid block in docs/flows/${slug}.md`);
  return match[1]!;
}

describe("flowMermaid", () => {
  // The Go generator and this port draw the same diagram, or one of them is
  // wrong; the generated pages are the record of what the Go one drew.
  it.each(catalog.flows.map((f) => f.slug))(
    "draws %s as gen-markdown does",
    (slug) => {
      const flow = catalog.flows.find((f) => f.slug === slug)!;
      expect(flowMermaid(flow, flowAnswers(index, flow))).toBe(generated(slug));
    },
  );

  it("draws a synthesized response as a dashed reverse message", () => {
    const flow: Flow = {
      id: "flow.reply",
      slug: "reply",
      name: "Reply",
      summary: "",
      owner: "shop",
      participants: [
        { id: "client", kind: "actor", context: null },
        { id: "shop.api", kind: "service", context: "shop" },
      ],
      steps: [
        {
          type: "step",
          id: "request",
          from: "client",
          to: "shop.api",
          kind: "rpc",
          label: "GET /book",
          status: "declared",
        },
        {
          type: "step",
          id: "response",
          from: "shop.api",
          to: "client",
          kind: "response",
          label: "HTTP response",
          status: "declared",
          replyTo: "request",
        },
      ],
    };

    expect(flowMermaid(flow)).toContain(
      "p0->>p1: GET /book\n    p1-->>p0: HTTP response",
    );

    const response = flow.steps[1];
    if (response?.type !== "step") throw new Error("response fixture missing");
    response.http = { status: 500, outcome: "error" };
    response.label = "500 · Error";
    expect(flowMermaid(flow)).toContain(
      "rect rgba(183, 100, 107, 0.12)\n        p1-->>p0: 500 · Error\n    end",
    );
  });
});
