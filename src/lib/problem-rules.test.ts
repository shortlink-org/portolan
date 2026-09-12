// The rules behind the Problems page: every shipped rule compiles over its
// subject and runs clean on the frozen estate, the manifest's switches and
// re-grades take effect, and a rule of the estate's own sees what the schema
// says it sees. What each shipped rule finds is held by the tests beside the
// subjects they read - rules-data, rules-wire, rules-proto, rules-deploy and rules-edges.

import { describe, expect, it } from "vitest";
import { rawCatalog } from "../test-catalog";
import { buildIndex, validateCatalog } from "../catalog";
import type { Catalog } from "../catalog";
import { allProblems, evaluateProblems } from "./all-problems";
import {
  BUILTIN_RULES,
  builtinProblems,
  estateOf,
  evaluateRules,
  resolveRules,
  runRule,
  subjectsOf,
  SUBJECTS,
} from "./problem-rules";
import type { ProblemRule, ProblemRuleEntry, RuleSubject } from "./problem-rules";
import { problemRuleProblems, ruleExpressionProblems, SUBJECT_NAMES } from "./problem-rules-cel.mjs";

const catalog = validateCatalog(JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog);
const index = buildIndex(catalog);
const builtinIds = BUILTIN_RULES.map((rule) => rule.id);

const custom = (entry: Partial<ProblemRuleEntry> & { id: string }): ProblemRule => ({
  over: "event",
  severity: "warning",
  defaultSeverity: "warning",
  title: entry.id,
  note: entry.id,
  description: "",
  action: "",
  when: "true",
  message: "'m'",
  builtin: false,
  enabled: true,
  ...entry,
});

describe("rules/builtin.json", () => {
  it("gives every rule a subject, a severity and words", () => {
    for (const rule of BUILTIN_RULES) {
      expect(SUBJECT_NAMES, rule.id).toContain(rule.over);
      expect(["error", "warning"], rule.id).toContain(rule.severity);
      for (const field of ["title", "note", "description", "action"] as const) {
        expect(rule[field].trim().length, `${rule.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("is CEL that type-checks over its subject, rule by rule", () => {
    for (const rule of BUILTIN_RULES) expect(ruleExpressionProblems(rule), rule.id).toEqual([]);
  });

  it("runs clean over the sample estate", () => {
    const { failures, problems } = evaluateRules(catalog, index, resolveRules([]));
    expect(failures).toEqual([]);
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(builtinIds, problem.id).toContain(problem.rule);
  });

  it("has no two rules with one id", () => {
    expect(new Set(builtinIds).size).toBe(builtinIds.length);
  });
});

describe("resolveRules", () => {
  it("is every shipped rule, on, without a manifest entry", () => {
    const rules = resolveRules([]);
    expect(rules.map((rule) => rule.id)).toEqual(builtinIds);
    expect(rules.every((rule) => rule.enabled && rule.builtin)).toBe(true);
  });

  it("switches and re-grades a shipped rule, and keeps the passport's own severity", () => {
    const rules = resolveRules([
      { id: "shared-store", enabled: false, reason: "one database by design" },
      { id: "cross-service-lineage", severity: "error" },
    ]);
    const shared = rules.find((rule) => rule.id === "shared-store")!;
    expect(shared.enabled).toBe(false);
    expect(shared.reason).toBe("one database by design");
    const lineage = rules.find((rule) => rule.id === "cross-service-lineage")!;
    expect(lineage.severity).toBe("error");
    expect(lineage.defaultSeverity).toBe("warning");
  });

  it("appends the manifest's own rules after the shipped ones", () => {
    const rules = resolveRules([{ id: "team.quiet-event", over: "event", when: "true", message: "'x'", title: "Quiet event" }]);
    const last = rules[rules.length - 1]!;
    expect(last.id).toBe("team.quiet-event");
    expect(last.builtin).toBe(false);
    expect(last.note).toBe("Quiet event");
    expect(last.severity).toBe("warning");
  });
});

describe("evaluateRules", () => {
  const all = builtinProblems(catalog, index);

  it("drops a switched-off rule's rows and still counts them", () => {
    const fk = all.filter((problem) => problem.rule === "cross-service-fk");
    expect(fk.length).toBeGreaterThan(0);
    const { problems, matches } = evaluateRules(catalog, index, resolveRules([{ id: "cross-service-fk", enabled: false, reason: "by design" }]));
    expect(problems.some((problem) => problem.rule === "cross-service-fk")).toBe(false);
    expect(problems.length).toBe(all.length - fk.length);
    expect(matches.get("cross-service-fk")).toBe(fk.length);
  });

  it("re-grades a rule's rows", () => {
    const { problems } = evaluateRules(catalog, index, resolveRules([{ id: "cross-service-fk", severity: "warning" }]));
    const fk = problems.filter((problem) => problem.rule === "cross-service-fk");
    expect(fk.length).toBeGreaterThan(0);
    expect(fk.every((problem) => problem.severity === "warning")).toBe(true);
  });

  it("sorts errors first after the rules have spoken", () => {
    const { problems } = evaluateProblems(catalog, index, resolveRules([{ id: "cross-service-fk", severity: "warning" }]));
    const firstWarning = problems.findIndex((problem) => problem.severity === "warning");
    expect(problems.slice(firstWarning).every((problem) => problem.severity === "warning")).toBe(true);
    expect(allProblems(catalog, index, resolveRules([])).length).toBe(all.length);
  });
});

describe("a rule of the estate's own", () => {
  it("runs over every event and says which it matched", () => {
    const rule = custom({
      id: "team.quiet-event",
      when: "size(event.consumers) == 0",
      message: "'nothing consumes ' + event.name",
      peer: "event.service",
    });
    const { problems, failure } = runRule(rule, catalog, index);
    expect(failure).toBeUndefined();
    const quiet = subjectsOf(catalog, index, "event").filter((subject) => (subject.row.consumers as string[]).length === 0);
    expect(problems.length).toBe(quiet.length);
    expect(problems.length).toBeGreaterThan(0);
    const first = problems[0]!;
    expect(first.rule).toBe("team.quiet-event");
    expect(first.id).toBe(quiet[0]!.id);
    expect(first.note).toBe(`nothing consumes ${quiet[0]!.row.name}`);
    expect(first.peer).toBe(quiet[0]!.service);
    expect(first.context).toBe(quiet[0]!.context);
  });

  it("sees the estate beside its subject", () => {
    const inside = runRule(custom({ id: "a", over: "call", when: "call.peer in estate.services", message: "'in'" }), catalog, index);
    const outside = runRule(custom({ id: "b", over: "call", when: "!(call.peer in estate.services)", message: "'out'" }), catalog, index);
    expect(inside.failure).toBeUndefined();
    expect(outside.failure).toBeUndefined();
    expect(inside.problems.length + outside.problems.length).toBe(subjectsOf(catalog, index, "call").length);
    expect(estateOf(catalog).services).toContain("shop.cart");
  });

  it("runs over flows and aggregates, and lands on the page each has", () => {
    const flows = runRule(
      custom({ id: "team.unproven-flow", over: "flow", when: "flow.verifiedSteps == 0 && flow.steps > 0", message: "flow.name + ' has never been seen running'" }),
      catalog,
      index,
    );
    expect(flows.failure).toBeUndefined();
    const unproven = subjectsOf(catalog, index, "flow").filter((subject) => subject.row.verifiedSteps === 0n && (subject.row.steps as bigint) > 0n);
    expect(flows.problems.length).toBe(unproven.length);
    expect(flows.problems.length).toBeGreaterThan(0);
    expect(flows.problems[0]!.context).toBe(unproven[0]!.row.owner);

    const aggregates = runRule(
      custom({ id: "team.silent-aggregate", over: "aggregate", when: "size(aggregate.events) == 0 && !aggregate.modelGroup", message: "aggregate.name + ' raises no event'", peer: "aggregate.service" }),
      catalog,
      index,
    );
    expect(aggregates.failure).toBeUndefined();
    const silent = subjectsOf(catalog, index, "aggregate").filter((subject) => (subject.row.events as string[]).length === 0 && subject.row.modelGroup === false);
    expect(aggregates.problems.length).toBe(silent.length);
    for (const problem of aggregates.problems) expect(index.aggregateById.has(problem.id), problem.id).toBe(true);
  });

  it("refuses a field the subject does not have, before any row", () => {
    const { problems, failure } = runRule(custom({ id: "a", when: "event.nme == 'x'", message: "'m'" }), catalog, index);
    expect(problems).toEqual([]);
    expect(failure?.message).toMatch(/nme/);
  });

  it("refuses a condition that is not a bool and a message that is not a string", () => {
    expect(runRule(custom({ id: "a", when: "event.id", message: "'m'" }), catalog, index).failure?.message).toMatch(/bool/);
    expect(runRule(custom({ id: "b", when: "true", message: "event.versions" }), catalog, index).failure?.message).toMatch(/string/);
  });

  it("is counted but not shown while switched off", () => {
    const rule = custom({ id: "team.off", when: "true", message: "'m'", enabled: false });
    const { problems, matches, failures } = evaluateRules(catalog, index, [rule]);
    expect(problems).toEqual([]);
    expect(failures).toEqual([]);
    expect(matches.get("team.off")).toBe(subjectsOf(catalog, index, "event").length);
  });
});

describe("subjects", () => {
  const shapes: Record<string, (value: unknown) => boolean> = {
    string: (value) => typeof value === "string",
    int: (value) => typeof value === "bigint",
    bool: (value) => typeof value === "boolean",
    "list<string>": (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
  };

  // The frozen estate declares no AsyncAPI channel, no deployment and no
  // vendored copy; one of each is added so every subject is proved on a
  // row, not on an absence.
  const furnished: Catalog = JSON.parse(JSON.stringify(rawCatalog)) as unknown as Catalog;
  const first = furnished.contexts[0]!.services[0]!;
  first.channels = [
    { address: "shop.cart.basket", kind: "event", messages: [{ name: "cart.BasketCreated", direction: "send" }, { name: "payments.PaymentAuthorized", direction: "receive" }], source: "asyncapi.yaml" },
  ];
  first.copies = [{ id: "pricing.v1.Pricing", methods: [{ name: "GetQuote", request: "GetQuoteRequest", response: "Quote" }], source: "vendor/pricing.proto" }];
  furnished.deployments = [
    { id: "argocd/cart", name: "cart", project: "shop", environment: "prod", cluster: "in-cluster", namespace: "shop", repo: first.repo, path: first.path, targetRevision: "main", revision: "abc", tool: "kustomize", url: "https://argocd/cart" },
  ];
  const furnishedCatalog = validateCatalog(furnished);
  const furnishedIndex = buildIndex(furnishedCatalog);

  for (const over of SUBJECT_NAMES as RuleSubject[]) {
    it(`${over}: every row has exactly the schema's fields, typed as it says`, () => {
      const rows = subjectsOf(furnishedCatalog, furnishedIndex, over);
      expect(rows.length, over).toBeGreaterThan(0);
      const schema = SUBJECTS[over].schema;
      for (const subject of rows) {
        expect(Object.keys(subject.row).sort(), subject.id).toEqual(Object.keys(schema).sort());
        for (const [field, type] of Object.entries(schema)) {
          expect(shapes[type]!(subject.row[field]), `${over} ${subject.id}.${field} as ${type}`).toBe(true);
        }
        expect(subject.id.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("problemRuleProblems", () => {
  it("accepts a switch, a re-grade and a whole rule", () => {
    expect(
      problemRuleProblems(
        [
          { id: "shared-store", enabled: false, reason: "by design" },
          { id: "cross-service-fk", severity: "warning" },
          { id: "team.quiet-event", over: "event", when: "size(event.consumers) == 0", message: "'quiet ' + event.id", title: "Quiet event" },
        ],
        builtinIds,
      ),
    ).toEqual([]);
  });

  it("names what is wrong, by entry and field", () => {
    const problems = problemRuleProblems(
      [
        { id: "shared-store", enabled: false },
        { id: "rpc", when: "true" },
        { id: "team.a", over: "event", when: "event.nme == 'x'", message: "'m'", title: "A" },
        { id: "team.b", over: "event", when: "true", message: "event.versions", title: "B" },
        { id: "team.c", over: "nowhere", when: "true", message: "'m'", title: "C" },
        { id: "team.d", over: "event", when: "true", message: "'m'" },
        { id: "Bad Id", over: "event", when: "true", message: "'m'", title: "D" },
        { id: "team.a", over: "event", when: "true", message: "'m'", title: "again" },
      ],
      builtinIds,
      "x.json",
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^x\.json problemRules\/0\/reason: /),
        expect.stringMatching(/^x\.json problemRules\/1\/when: "rpc" is a built-in rule/),
        expect.stringMatching(/^x\.json problemRules\/2\/when: .*nme/),
        expect.stringMatching(/^x\.json problemRules\/3\/message: CEL expression must return string/),
        expect.stringMatching(/^x\.json problemRules\/4\/over: /),
        expect.stringMatching(/^x\.json problemRules\/5\/title: required/),
        expect.stringMatching(/^x\.json problemRules\/6\/id: /),
        expect.stringMatching(/^x\.json problemRules\/7\/id: "team\.a" appears twice/),
      ]),
    );
    expect(problems.length).toBe(8);
  });

  it("is nothing to say about a manifest without the key", () => {
    expect(problemRuleProblems(undefined, builtinIds)).toEqual([]);
  });
});
