import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { rawCatalog as raw } from "../test-catalog";
import type { Catalog, Flow } from "../catalog";
import { RecordingsChip } from "./Recordings";

const catalog = raw as unknown as Catalog;
const checkout = catalog.flows.find((f) => f.slug === "checkout") as Flow;

/**
 * Rendered once, statically: no local server answers here, so the chip is
 * what a published site shows - the recordings the catalog carries, or
 * nothing.
 */
function render(flow: Flow, exampleId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecordingsChip flow={flow} exampleId={exampleId} onExample={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const example = (traceId: string) => ({
  id: `examples/shop/telemetry/traces.jsonl#${traceId}`,
  recording: "examples/shop/telemetry/traces.jsonl",
  traceId,
  durationMs: 12.5,
  steps: [{ step: "s1", durationMs: 12.5 }],
});

describe("the recordings chip", () => {
  it("counts the flow's recordings and says which one is lit", () => {
    const flow = { ...checkout, examples: [example("aaaaaaaa1"), example("bbbbbbbb2")] };
    const markup = render(flow);
    expect(markup).toContain("recordings · 2");
    expect(markup).toContain("Recordings — 2 recordings");

    const lit = render(flow, flow.examples[1]!.id);
    expect(lit).toContain("lighting #bbbbbbbb");
    expect(lit).toContain("border-accent");
  });

  it("is not on the page at all when there is nothing to show and nowhere to add", () => {
    expect(render({ ...checkout, examples: undefined })).toBe("");
  });
});
