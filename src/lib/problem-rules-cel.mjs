// The CEL half of a problem rule: what an expression may read, and whether
// it reads it correctly.
//
// Plain JavaScript on purpose, like django-aggregates.mjs: the manifest is
// checked by scripts/manifest.mjs under Node, where nothing strips types, and
// the same expression runs in the browser over the merged catalog. One file
// says what `event.consumers` is so that the two cannot disagree. Types live
// in problem-rules-cel.d.mts.
//
// A rule is written over ONE subject - a service, an event, a channel, a
// table, a deployment or a call - and reads a flat view of it: strings, ints,
// bools and lists of strings. It is not written over the catalog. A rule that
// needs the graph - who else writes this table, where a column's value came
// from - is a reader in TypeScript with a passport in rules/builtin.json,
// because a predicate over one row cannot see the row next to it, and giving
// it the whole catalog makes every rule a program.

import { Environment } from "@marcbachmann/cel-js";

/**
 * What each subject shows to an expression. The field list is the contract a
 * rule is type-checked against: `event.nme` is refused when the manifest is
 * read, not discovered as an empty page.
 */
export const SUBJECTS = {
  service: {
    description: "One service of the estate, with counts of what it declares.",
    schema: {
      id: "string",
      slug: "string",
      name: "string",
      context: "string",
      kind: "string",
      repo: "string",
      path: "string",
      technologies: "list<string>",
      owners: "list<string>",
      provides: "int",
      methods: "int",
      calls: "int",
      unresolvedCalls: "int",
      aggregates: "int",
      events: "int",
      stores: "list<string>",
      channels: "list<string>",
      hosts: "list<string>",
      dials: "list<string>",
    },
  },
  event: {
    description: "One domain event, as its owning aggregate declares it.",
    schema: {
      id: "string",
      slug: "string",
      name: "string",
      aggregate: "string",
      service: "string",
      context: "string",
      versions: "int",
      deprecated: "bool",
      consumers: "list<string>",
      unresolvedConsumers: "int",
      wireName: "string",
      channel: "string",
      fields: "list<string>",
    },
  },
  channel: {
    description: "One channel a service's AsyncAPI document declares.",
    schema: {
      address: "string",
      kind: "string",
      title: "string",
      service: "string",
      context: "string",
      sends: "list<string>",
      receives: "list<string>",
      source: "string",
    },
  },
  table: {
    description: "One table of a store, with what the code does to it.",
    schema: {
      id: "string",
      name: "string",
      store: "string",
      storeKind: "string",
      owner: "string",
      context: "string",
      role: "string",
      aggregate: "string",
      block: "string",
      columns: "list<string>",
      primaryKey: "list<string>",
      foreignKeys: "list<string>",
      indexes: "int",
      reads: "int",
      writes: "int",
      deletes: "int",
    },
  },
  deployment: {
    description: "One Application the deployer manages.",
    schema: {
      id: "string",
      name: "string",
      project: "string",
      environment: "string",
      cluster: "string",
      namespace: "string",
      repo: "string",
      path: "string",
      chart: "string",
      targetRevision: "string",
      revision: "string",
      tool: "string",
      service: "string",
      context: "string",
      images: "list<string>",
      basis: "string",
      drifted: "bool",
    },
  },
  flow: {
    description: "One flow, with how much of it has been seen running.",
    schema: {
      id: "string",
      slug: "string",
      name: "string",
      owner: "string",
      trigger: "string",
      triggerConfidence: "string",
      participants: "list<string>",
      contexts: "list<string>",
      crossContext: "bool",
      steps: "int",
      verifiedSteps: "int",
      declaredSteps: "int",
      unresolvedSteps: "int",
      seenSteps: "int",
      events: "list<string>",
      stores: "list<string>",
      examples: "int",
      source: "string",
    },
  },
  aggregate: {
    description: "One aggregate, with what its domain model declares.",
    schema: {
      id: "string",
      slug: "string",
      name: "string",
      root: "string",
      modelGroup: "bool",
      service: "string",
      context: "string",
      entities: "int",
      valueObjects: "int",
      enums: "int",
      commands: "int",
      queries: "int",
      exposedOperations: "int",
      deprecatedOperations: "int",
      events: "list<string>",
      states: "list<string>",
      transitions: "int",
      tables: "list<string>",
    },
  },
  call: {
    description: "One call a service makes on another's interface.",
    schema: {
      id: "string",
      interface: "string",
      method: "string",
      peer: "string",
      status: "string",
      resolved: "bool",
      service: "string",
      context: "string",
      source: "string",
      module: "string",
    },
  },
};

/** What every rule sees beside its subject: the estate's names, for `in`. */
export const ESTATE_SCHEMA = {
  services: "list<string>",
  contexts: "list<string>",
  stores: "list<string>",
  channels: "list<string>",
  externals: "list<string>",
};

export const SUBJECT_NAMES = Object.keys(SUBJECTS);

export const SEVERITIES = ["error", "warning"];

/** A rule id: dotted or dashed lower-case segments, the way a warning rule's is. */
export const RULE_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

const LIMITS = {
  maxAstNodes: 512,
  maxDepth: 32,
  maxListElements: 64,
  maxMapEntries: 64,
  maxCallArguments: 8,
};

const environments = new Map();

/** One environment per subject, built on first use and kept. */
export function environmentFor(subject) {
  const known = environments.get(subject);
  if (known) return known;
  const definition = SUBJECTS[subject];
  if (!definition) throw new Error(`unknown subject "${subject}"; one of ${SUBJECT_NAMES.join(", ")}`);
  const environment = new Environment({ unlistedVariablesAreDyn: false, limits: LIMITS })
    .registerVariable({ name: subject, schema: definition.schema })
    .registerVariable({ name: "estate", schema: ESTATE_SCHEMA });
  environments.set(subject, environment);
  return environment;
}

const compiled = new Map();

/**
 * Parses and type-checks one expression over one subject, and refuses one
 * that does not come out as `type`. The error names the field: it is what the
 * manifest check prints and what the page shows under the text box.
 */
export function compileExpression(subject, source, type) {
  const key = `${subject}\0${type}\0${source}`;
  const known = compiled.get(key);
  if (known) return known;
  let expression;
  try {
    expression = environmentFor(subject).parse(source);
  } catch (cause) {
    throw new Error(`invalid CEL: ${firstLine(cause)}`);
  }
  const checked = expression.check();
  if (!checked.valid) throw new Error(`invalid CEL: ${firstLine(checked.error ?? "type check failed")}`);
  if (checked.type !== type) throw new Error(`CEL expression must return ${type}, got ${checked.type}`);
  compiled.set(key, expression);
  return expression;
}

/**
 * Everything wrong with one rule entry as written, as lines. Empty when the
 * entry is good. `builtinIds` are the rules that have a reader: an entry
 * naming one may only switch it, re-grade it and say why; any other id must
 * carry a whole rule.
 */
export function problemRuleProblems(entries, builtinIds, path = "portolan.json") {
  const problems = [];
  if (entries === undefined) return problems;
  if (!Array.isArray(entries)) return [`${path} problemRules: must be an array`];
  const builtin = new Set(builtinIds);
  const seen = new Set();
  entries.forEach((entry, index) => {
    const at = `${path} problemRules/${index}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${at}: must be an object`);
      return;
    }
    if (typeof entry.id !== "string" || !RULE_ID.test(entry.id)) {
      problems.push(`${at}/id: must match ${RULE_ID}`);
      return;
    }
    if (seen.has(entry.id)) problems.push(`${at}/id: "${entry.id}" appears twice`);
    seen.add(entry.id);
    if (entry.severity !== undefined && !SEVERITIES.includes(entry.severity)) {
      problems.push(`${at}/severity: must be one of ${SEVERITIES.join(", ")}`);
    }
    if (builtin.has(entry.id)) {
      for (const key of ["over", "when", "message", "peer", "title", "note", "description", "action"]) {
        if (entry[key] !== undefined) problems.push(`${at}/${key}: "${entry.id}" is a built-in rule; only enabled, severity and reason may be set`);
      }
      if (entry.enabled === false && !entry.reason) problems.push(`${at}/reason: a disabled rule needs a reason`);
      return;
    }
    if (!SUBJECT_NAMES.includes(entry.over)) {
      problems.push(`${at}/over: must be one of ${SUBJECT_NAMES.join(", ")}`);
      return;
    }
    if (typeof entry.title !== "string" || !entry.title.trim()) problems.push(`${at}/title: required`);
    if (typeof entry.when !== "string" || !entry.when.trim()) {
      problems.push(`${at}/when: required`);
    } else {
      try {
        compileExpression(entry.over, entry.when, "bool");
      } catch (cause) {
        problems.push(`${at}/when: ${firstLine(cause)}`);
      }
    }
    if (typeof entry.message !== "string" || !entry.message.trim()) {
      problems.push(`${at}/message: required`);
    } else {
      try {
        compileExpression(entry.over, entry.message, "string");
      } catch (cause) {
        problems.push(`${at}/message: ${firstLine(cause)}`);
      }
    }
    if (entry.peer !== undefined) {
      try {
        compileExpression(entry.over, entry.peer, "string");
      } catch (cause) {
        problems.push(`${at}/peer: ${firstLine(cause)}`);
      }
    }
  });
  return problems;
}

function firstLine(cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n", 1)[0];
}
