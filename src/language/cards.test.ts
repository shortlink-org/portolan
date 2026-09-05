import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import type { Catalog, Term } from "../catalog";
import { homonyms, matchTerms, vocabularies } from "./cards";

const term = (id: string, context: string, slug: string, name = slug): Term => ({
  id,
  slug,
  context,
  name,
  definition: "one sentence.",
  source: "GLOSSARY.md:1",
});

/** A catalog with only what these functions read. */
const of = (terms: Term[], contexts: string[] = ["auth", "shop"]): Catalog =>
  ({
    contexts: contexts.map((id) => ({ id, slug: id, name: id, services: [] })),
    terms,
  }) as unknown as Catalog;

describe("vocabularies", () => {
  it("groups by context, in catalog order, alphabetical inside", () => {
    const arranged = vocabularies(
      of([
        term("shop.order", "shop", "order", "Order"),
        term("auth.session", "auth", "session", "Session"),
        term("auth.attempt", "auth", "attempt", "Attempt"),
      ]),
    );

    expect(arranged.map((v) => v.contextId)).toEqual(["auth", "shop"]);
    expect(arranged[0]?.terms.map((t) => t.name)).toEqual([
      "Attempt",
      "Session",
    ]);
  });

  it("leaves out a context that has written no glossary", () => {
    const arranged = vocabularies(of([term("auth.session", "auth", "session")]));

    expect(arranged).toHaveLength(1);
  });

  // The validator refuses this catalog, so nothing should ever render it. The
  // arrangement still shows the terms rather than dropping them: a list that
  // silently loses rows is the harder bug of the two.
  it("still shows terms whose context the catalog does not declare", () => {
    const arranged = vocabularies(of([term("oms.order", "oms", "order")]));

    expect(arranged).toHaveLength(1);
    expect(arranged[0]?.context).toBeNull();
    expect(arranged[0]?.contextId).toBe("oms");
  });
});

describe("homonyms", () => {
  it("finds one word meant in two contexts", () => {
    const found = homonyms(
      of([
        term("auth.bus", "auth", "bus", "Bus"),
        term("shop.bus", "shop", "bus", "Bus"),
        term("auth.session", "auth", "session", "Session"),
      ]),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.word).toBe("Bus");
    expect(found[0]?.terms.map((t) => t.context)).toEqual(["auth", "shop"]);
  });

  it("says nothing about a word only one context uses", () => {
    expect(homonyms(of([term("auth.session", "auth", "session")]))).toEqual([]);
  });

  // What the estate actually has, and the reason the section exists: two
  // services describe the same piece of plumbing in their own words.
  it("finds the words the example estate means twice", () => {
    expect(homonyms(catalog).map((h) => h.slug)).toEqual(["bus", "outbox"]);
  });
});

describe("matchTerms", () => {
  const terms = [
    {
      ...term("auth.session", "auth", "session", "Session"),
      definition:
        "Proof that a user logged in, and the token it is presented with.",
    },
    {
      ...term("auth.lockout", "auth", "lockout", "Lockout"),
      definition: "An account refusing passwords for a while.",
    },
  ];

  it("matches on the name", () => {
    expect(matchTerms(terms, "lock").map((t) => t.name)).toEqual(["Lockout"]);
  });

  it("matches on the definition, not only the word", () => {
    expect(matchTerms(terms, "token").map((t) => t.name)).toEqual(["Session"]);
  });

  it("takes every word, in any order", () => {
    expect(matchTerms(terms, "passwords account").map((t) => t.name)).toEqual([
      "Lockout",
    ]);
    expect(matchTerms(terms, "passwords token")).toEqual([]);
  });

  it("answers an empty query with everything", () => {
    expect(matchTerms(terms, "   ")).toHaveLength(2);
  });
});
