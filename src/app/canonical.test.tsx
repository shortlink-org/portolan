// @vitest-environment jsdom
//
// A flow pasted by its catalog id - out of a warning, the CLI or a work item -
// lands on the flow and ends at the slug URL, so there is one URL per flow.

import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { index } from "../testing/estate";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { CanonicalSlug, slugForId } from "./canonical";

let rendered: Rendered | undefined;
afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
});

/** Stands in for the flow page: what it would look up, and where it is. */
function FlowProbe() {
  const { flow: slug } = useParams();
  const { pathname, hash } = useLocation();
  const flow = slug ? index.flowBySlug.get(slug) : undefined;
  return <p>{`${flow ? flow.name : "Flow not found"} at ${pathname}${hash}`}</p>;
}

async function open(url: string): Promise<Rendered> {
  rendered = await render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/flows/:flow"
          element={
            <CanonicalSlug index={index} param="flow" slugFor={slugForId.flow} path={(slug) => `/flows/${slug}`}>
              <FlowProbe />
            </CanonicalSlug>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return rendered;
}

describe("CanonicalSlug", () => {
  const checkout = index.flowById.get("flow.checkout")!;

  it("opens a flow by its catalog id at the slug URL", async () => {
    const { text } = await open("/flows/flow.checkout");
    expect(text()).toBe(`${checkout.name} at /flows/checkout`);
  });

  it("keeps the hash across the redirect", async () => {
    const { text } = await open("/flows/flow.checkout#step");
    expect(text()).toBe(`${checkout.name} at /flows/checkout#step`);
  });

  it("leaves a slug URL where it is", async () => {
    const { text } = await open("/flows/checkout");
    expect(text()).toBe(`${checkout.name} at /flows/checkout`);
  });

  it("keeps the not-found page for a value that is neither", async () => {
    const { text } = await open("/flows/flow.nope");
    expect(text()).toBe("Flow not found at /flows/flow.nope");
  });

  it("resolves ids for the other slug-routed pages, and nothing for a slug", () => {
    for (const [kind, slugs, ids] of [
      ["adr", index.adrBySlug, index.adrById],
      ["rfc", index.rfcBySlug, index.rfcById],
      ["module", index.moduleBySlug, index.moduleById],
    ] as const) {
      for (const [id, entity] of ids) {
        expect(slugForId[kind](index, id), `${kind} ${id}`).toBe(slugs.has(id) ? undefined : entity.slug);
        expect(slugForId[kind](index, entity.slug)).toBeUndefined();
      }
    }
    for (const [id, external] of index.externalById) {
      expect(slugForId.external(index, id)).toBe(external.slug === id ? undefined : external.slug);
    }
  });
});
