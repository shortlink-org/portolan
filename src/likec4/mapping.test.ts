import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { classify } from "../selection/model";
import { fqn } from "./ids";
import { catalogIdOf } from "./mapping";

describe("catalogIdOf", () => {
  /**
   * The ID contract, checked rather than assumed: every catalog id must survive
   * the round trip through the LikeC4 identifier the generator emits for it.
   */
  it("inverts fqn for every element the generator emits", () => {
    const ids: string[] = [];
    for (const context of catalog.contexts) {
      ids.push(context.id);
      for (const service of context.services) {
        ids.push(service.id);
        for (const aggregate of service.aggregates) {
          ids.push(aggregate.id);
          for (const event of aggregate.events) ids.push(event.id);
        }
      }
    }
    for (const flow of catalog.flows) {
      for (const participant of flow.participants) ids.push(participant.id);
    }

    for (const id of ids) {
      expect(catalogIdOf(fqn(id)), id).toBe(id);
    }
  });

  it("undoes the substitution LikeC4 identifiers force", () => {
    // "fraud-scoring" cannot be a LikeC4 identifier; "fraud_scoring" can.
    expect(fqn("fraud-scoring")).toBe("fraud_scoring");
    expect(catalogIdOf("fraud_scoring")).toBe("fraud-scoring");
    expect(catalogIdOf("shop.pricing.price_list")).toBe(
      "shop.pricing.price-list",
    );
  });

  it("hands back an id it has never seen, so the click still lands", () => {
    expect(catalogIdOf("nothing_here")).toBe("nothing_here");
    expect(classify(catalogIdOf("nothing_here"))).toBe("unknown");
  });
});
