// @vitest-environment jsdom
//
// A flow pasted by its catalog id - out of a warning, the CLI or a work item -
// lands on the flow and ends at the slug URL, so there is one URL per flow.

import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { index } from "../testing/estate";
import { render } from "../testing/render";
import type { Rendered } from "../testing/render";
import { CanonicalSlug, IdEntry, pathForId, slugForId, withArrival } from "./canonical";
import { paths } from "../routes";

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

/** Stands in for every page: where the id entry left the reader. */
function Where() {
  const { pathname, search, hash } = useLocation();
  return <p>{`at ${pathname}${search}${hash}`}</p>;
}

async function enter(url: string): Promise<Rendered> {
  rendered = await render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/id/*" element={<IdEntry index={index} notFound={<p>Route not found</p>} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return rendered;
}

function first<T>(map: Map<string, T>): [string, T] {
  const entry = [...map][0];
  if (!entry) throw new Error("the estate lost a kind this test relies on");
  return entry;
}

describe("IdEntry", () => {
  const contextOf = (serviceId: string) => index.serviceContext.get(serviceId)!.id;
  const storePage = (storeId: string) => {
    const store = index.storeById.get(storeId)!;
    return paths.store(contextOf(store.owner), index.serviceById.get(store.owner)!.slug, store.slug);
  };

  it("opens every kind of entity at its own page", async () => {
    const [serviceId, service] = first(index.serviceById);
    const [aggregateId, aggregate] = first(index.aggregateById);
    const aggregateService = index.aggregateOwner.get(aggregateId)!;
    const [eventId, event] = first(index.eventById);
    const eventOwner = index.eventOwner.get(eventId)!;
    const [voId, vo] = [...index.blockById].find(([, owner]) => owner.kind === "vo")!;
    const [entityId, entity] = [...index.blockById].find(([, owner]) => owner.kind === "entity")!;
    const [enumId, item] = first(index.enumById);
    const [storeId] = first(index.storeById);
    const [tableId, table] = first(index.tableById);
    const [flowId, flow] = first(index.flowById);
    const [adrId, adr] = first(index.adrById);
    const [moduleId, module] = first(index.moduleById);
    const context = contextOf(serviceId);

    const cases: [string, string][] = [
      [context, paths.context(context)],
      [serviceId, paths.service(context, service.slug)],
      [aggregateId, paths.aggregate(contextOf(aggregateService.id), aggregateService.slug, aggregate.slug)],
      [
        eventId,
        paths.event(contextOf(eventOwner.service.id), eventOwner.service.slug, eventOwner.aggregate.slug, event.slug),
      ],
      [voId, paths.valueObject(vo.context.id, vo.service.slug, vo.aggregate.slug, vo.block.slug)],
      [entityId, paths.entity(entity.context.id, entity.service.slug, entity.aggregate.slug, entity.block.slug)],
      [enumId, paths.enum(item.context.id, item.service.slug, item.aggregate.slug, item.enum.slug)],
      [storeId, storePage(storeId)],
      [tableId, `${storePage(table.store.id)}#sel=table:${encodeURIComponent(tableId)}`],
      [flowId, paths.flow(flow.slug)],
      [adrId, paths.adr(adr.slug)],
      [moduleId, paths.module(module.slug)],
    ];
    for (const [id, page] of cases) {
      const { text, unmount } = await enter(paths.byId(id));
      expect(text(), id).toBe(`at ${page}`);
      unmount();
      rendered = undefined;
    }
  });

  it("resolves every id the index holds for the kinds with a page", () => {
    for (const map of [
      index.serviceById,
      index.aggregateById,
      index.eventById,
      index.blockById,
      index.enumById,
      index.storeById,
      index.tableById,
      index.viewById,
      index.flowById,
      index.adrById,
      index.rfcById,
      index.moduleById,
      index.externalById,
      index.termById,
    ] as Map<string, unknown>[]) {
      for (const id of map.keys()) expect(pathForId(index, id), id).toBeDefined();
    }
  });

  it("keeps the query and the hash the reader arrived with", async () => {
    const [eventId] = first(index.eventById);
    const page = pathForId(index, eventId)!;
    const { text } = await enter(`${paths.byId(eventId)}?version=2&catalog=example#ev-schema`);
    expect(text()).toBe(`at ${page}?version=2&catalog=example#ev-schema`);
  });

  it("keeps a table's own selection unless the reader brought a hash", () => {
    expect(withArrival("/c/a/b/data/pg#sel=table:x", "?q=1", "")).toBe("/c/a/b/data/pg?q=1#sel=table:x");
    expect(withArrival("/c/a/b/data/pg#sel=table:x", "", "#mine")).toBe("/c/a/b/data/pg#mine");
    expect(withArrival("/language?term=a.b", "?catalog=x", "")).toBe("/language?term=a.b&catalog=x");
  });

  it("shows not-found for an id nothing answers to", async () => {
    const { text } = await enter("/id/shop.nope.nothing");
    expect(text()).toBe("Route not found");
  });

  it("takes a module id with slashes in it", async () => {
    const [moduleId, module] = first(index.moduleById);
    expect(moduleId).toContain("/");
    const { text } = await enter(`/id/${moduleId}`);
    expect(text()).toBe(`at ${paths.module(module.slug)}`);
  });
});
