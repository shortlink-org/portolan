// What the documentation rules find: a service that records no stack, one with
// no README, one whose name uses an abbreviation nothing explains, and a
// channel that says nothing about what it travels on.

import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { buildIndex } from "../catalog";
import type { Catalog, Service } from "../catalog";
import { builtinProblems } from "./problem-rules";

const RULES = ["service-stack-unknown", "service-undescribed", "service-abbreviation-unexplained", "channel-transport-unknown"];

/** The catalog with every service described and built with something, then `change` applied. */
function estate(change: (service: Service) => Service = (service) => service): Catalog {
  return {
    ...catalog,
    contexts: catalog.contexts.map((context) => ({
      ...context,
      services: context.services.map((service) =>
        change({
          ...service,
          name: service.name.replace(/\b[A-Z]{2,}\b/g, "Word"),
          technologies: ["Go"],
          readme: `# ${service.name}\n\nDoes one thing.`,
          channels: (service.channels ?? []).map((channel) => ({ ...channel, protocol: "nats" })),
          aggregates: service.aggregates.map((aggregate) => ({
            ...aggregate,
            events: aggregate.events.map((event) => ({ ...event, wire: undefined })),
          })),
        }),
      ),
    })),
  };
}

const found = (of: Catalog) =>
  builtinProblems(of, buildIndex(of), RULES).map((problem) => `${problem.rule} ${problem.id}`);

describe("documentation rules", () => {
  const first = catalog.contexts[0]!.services[0]!;

  it("say nothing about services that record a stack and a README", () => {
    expect(found(estate())).toEqual([]);
  });

  it("name the service that records no language or runtime", () => {
    const of = estate((service) => (service.id === first.id ? { ...service, technologies: [] } : service));
    expect(found(of)).toEqual([`service-stack-unknown ${first.id}`]);
  });

  it("name the service whose README is missing or blank", () => {
    const of = estate((service) => (service.id === first.id ? { ...service, readme: " \n" } : service));
    expect(found(of)).toEqual([`service-undescribed ${first.id}`]);
  });

  it("name the abbreviation in a service's name that neither the glossary nor the common list explains", () => {
    const of = estate((service) => (service.id === first.id ? { ...service, name: "Orders ZQX over HTTP" } : service));
    expect(found(of)).toEqual([`service-abbreviation-unexplained ${first.id}`]);
    const defined = { ...of, terms: [{ id: "x.zqx", slug: "zqx", context: "x", name: "ZQX", definition: "The zone queue exchange.", source: "GLOSSARY.md:1" }] };
    expect(found(defined)).toEqual([]);
  });

  it("name the channel that no declaration gives a transport, and take one another service declares", () => {
    const withChannel = (protocol: string | undefined, elsewhere?: string) =>
      estate((service) => {
        if (service.id === first.id) return { ...service, channels: [{ address: "orders", ...(protocol ? { protocol } : {}), messages: [{ name: "Placed", direction: "send" as const }] }] };
        if (elsewhere && service.id !== first.id) return { ...service, channels: [{ address: "orders", protocol: elsewhere, messages: [{ name: "Placed", direction: "receive" as const }] }] };
        return service;
      });
    expect(found(withChannel(undefined))).toEqual(["channel-transport-unknown " + first.id]);
    expect(found(withChannel("kafka"))).toEqual([]);
    expect(found(withChannel(undefined, "nats"))).toEqual([]);
  });
});
