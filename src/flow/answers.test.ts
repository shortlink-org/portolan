import { describe, expect, it } from "vitest";
import { catalog, index } from "../data";
import { walkSteps } from "../catalog";
import { flowAnswers, stepAnswer } from "./answers";

const flow = (slug: string) => {
  const found = catalog.flows.find((f) => f.slug === slug);
  if (!found) throw new Error(`no flow ${slug}`);
  return found;
};

const step = (slug: string, id: string) => {
  const found = walkSteps(flow(slug).steps).find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id} in ${slug}`);
  return found;
};

describe("stepAnswer", () => {
  it("reads the answer of an endpoint off the document that declares it", () => {
    // billing's ViewSet is exposed by billing.v1.Invoices, and the document
    // says a void answers 204 and an issue answers with the invoice's id.
    expect(stepAnswer(index, step("billing-invoice-destroy", "s1"))).toBe("204");
    expect(stepAnswer(index, step("billing-invoice-issue", "s1"))).toBe(
      "InvoiceId",
    );
  });

  it("reads the answer of a call to another service off the callee's contract", () => {
    expect(stepAnswer(index, step("cart-checkout", "s2"))).toBe("SessionInfo");
  });

  it("has none for a hop no interface describes", () => {
    // A call lands inside a service - a repository, a queryset - and an event
    // is a publication. Neither has a reply to read.
    for (const s of walkSteps(flow("billing-invoice-destroy").steps)) {
      if (s.kind !== "rpc") expect(stepAnswer(index, s), s.id).toBeUndefined();
    }
  });

  it("collects a flow's answers by step id", () => {
    const answers = flowAnswers(index, flow("cart-checkout"));
    expect([...answers.entries()].sort()).toEqual([
      ["s1", "CheckedOut"],
      ["s2", "SessionInfo"],
    ]);
  });
});
