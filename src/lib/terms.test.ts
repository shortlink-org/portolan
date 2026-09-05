import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import { bindTerms } from "./terms";

const bound = bindTerms(catalog);

const namesOf = (termId: string) =>
  (bound.byTerm.get(termId) ?? []).map((t) => `${t.kind}:${t.name}`);

describe("bindTerms", () => {
  it("pairs a word with the aggregate, the entity and the value object it names", () => {
    expect(namesOf("auth.session")).toContain("entity:Session");
    expect(namesOf("auth.token")).toContain("vo:Token");
    // The value object is called email.Address in the code and Email address
    // in the glossary; the slug is what the two agree on.
    expect(namesOf("auth.email-address")).toContain("vo:email.Address");
  });

  it("pairs a word with the command or query that runs it", () => {
    expect(namesOf("auth.login")).toContain("command:Login");
    expect(namesOf("auth.validate")).toContain("query:Validate");
  });

  it("pairs a word with a lifecycle state, which has no page of its own", () => {
    const locked = bound.byTerm.get("auth.locked") ?? [];
    const state = locked.find((t) => t.kind === "state");

    expect(state?.name).toBe("locked");
    expect(state?.path).toMatch(/#bb-lifecycle$/);
  });

  it("answers from the other end too", () => {
    const session = catalog.contexts
      .flatMap((c) => c.services)
      .flatMap((s) => s.aggregates)
      .find((a) => a.id === "auth.auth.session");
    if (!session) throw new Error("fixture has no session aggregate");

    expect(bound.byTarget.get(session.id)?.name).toBe("Session");
  });

  // The rule is exact, inside one context, and that is the whole rule. A
  // matcher loose enough to pair Register with registerUser is loose enough to
  // pair Line with Lineage, and a wrong pairing is worse than none because the
  // reader believes it.
  it("says nothing about a word that names nothing", () => {
    for (const word of ["auth.bus", "auth.outbox", "auth.refusal"]) {
      expect(bound.byTerm.get(word)).toBeUndefined();
    }
  });

  it("never pairs across a context boundary", () => {
    for (const [termId, targets] of bound.byTerm) {
      const context = termId.slice(0, termId.indexOf("."));
      for (const target of targets) {
        expect(target.id.startsWith(`${context}.`), `${termId} -> ${target.id}`).toBe(true);
      }
    }
  });

  it("is empty for a catalog with no glossary", () => {
    const bare = bindTerms({ ...catalog, terms: [] });

    expect(bare.byTerm.size).toBe(0);
    expect(bare.byTarget.size).toBe(0);
  });
});
