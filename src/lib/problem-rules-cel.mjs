// The CEL half of a problem rule: what an expression may read, and whether
// it reads it correctly.
//
// Plain JavaScript on purpose, like django-aggregates.mjs: the manifest is
// checked by scripts/manifest.mjs under Node, where nothing strips types, and
// the same expression runs in the browser over the merged catalog. One file
// says what `event.consumers` is so that the two cannot disagree. Types live
// in problem-rules-cel.d.mts.
//
// A rule is written over ONE subject and reads a flat view of it: strings,
// ints, bools and lists of strings. Everything a rule would have to join -
// who else writes the table, who publishes on the channel, whether a call's
// peer is in the estate - is a field on the row, computed once by
// problem-subjects.ts. The rule decides; the projection only describes
// (portolan.0017).

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
      hasReadme: "bool",
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
  call: {
    description: "One call a service makes on an interface, and whether the estate answers it.",
    schema: {
      id: "string",
      interface: "string",
      method: "string",
      peer: "string",
      status: "string",
      resolved: "bool",
      peerKnown: "bool",
      methodDeclared: "bool",
      service: "string",
      context: "string",
      source: "string",
      module: "string",
      note: "string",
    },
  },
  copy: {
    description: "One vendored copy of an interface, held against what the provider publishes.",
    schema: {
      id: "string",
      service: "string",
      context: "string",
      provider: "string",
      methods: "int",
      differences: "list<string>",
      source: "string",
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
      declaredChannels: "list<string>",
      fields: "list<string>",
    },
  },
  consumer: {
    description: "One consumer an event names, from the publisher's side.",
    schema: {
      event: "string",
      name: "string",
      aggregate: "string",
      owner: "string",
      context: "string",
      consumer: "string",
      status: "string",
      resolved: "bool",
      note: "string",
    },
  },
  channel: {
    description: "One channel a service touches, declared or named by its events, and who else publishes there.",
    schema: {
      address: "string",
      kind: "string",
      title: "string",
      service: "string",
      context: "string",
      declared: "bool",
      publishes: "bool",
      sends: "list<string>",
      receives: "list<string>",
      events: "list<string>",
      otherPublishers: "list<string>",
      otherClaims: "list<string>",
      source: "string",
    },
  },
  subscription: {
    description: "One message a service's document says it receives, and who in the estate sends it.",
    schema: {
      service: "string",
      context: "string",
      channel: "string",
      kind: "string",
      name: "string",
      encoding: "string",
      published: "bool",
      publishers: "list<string>",
      mismatched: "list<string>",
      mismatchedEncodings: "list<string>",
      source: "string",
    },
  },
  table: {
    description: "One table or view of a store, with what the model and the code say of it.",
    schema: {
      id: "string",
      name: "string",
      kind: "string",
      store: "string",
      storeKind: "string",
      owner: "string",
      context: "string",
      role: "string",
      aggregate: "string",
      aggregateOwner: "string",
      aggregateFields: "int",
      mappedColumns: "int",
      claimedColumns: "int",
      block: "string",
      columns: "list<string>",
      primaryKey: "list<string>",
      foreignKeys: "list<string>",
      foreignReads: "list<string>",
      hasPayload: "bool",
      indexes: "int",
      reads: "int",
      writes: "int",
      deletes: "int",
    },
  },
  column: {
    description: "One column of a table or view, with where its value points and where it came from.",
    schema: {
      id: "string",
      name: "string",
      relation: "string",
      kind: "string",
      store: "string",
      owner: "string",
      context: "string",
      type: "string",
      nullable: "bool",
      pk: "bool",
      fk: "string",
      fkOwner: "string",
      from: "list<string>",
      foreignFrom: "list<string>",
      foreignOwners: "list<string>",
      maps: "string",
      fieldType: "string",
      typeMatches: "bool",
    },
  },
  deployment: {
    description: "One Application the deployer manages, and whether the catalog can place it.",
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
      from: "string",
      targetRevision: "string",
      revision: "string",
      tool: "string",
      service: "string",
      labelled: "string",
      claimed: "bool",
      context: "string",
      runsIn: "string",
      images: "list<string>",
      basis: "string",
      drifted: "bool",
      drift: "string",
      url: "string",
    },
  },
  flow: {
    description: "One flow, with how much of it has been seen running.",
    schema: {
      id: "string",
      slug: "string",
      name: "string",
      summary: "string",
      owner: "string",
      trigger: "string",
      triggerConfidence: "string",
      participants: "list<string>",
      contexts: "list<string>",
      crossContext: "bool",
      uncontractedCrossings: "int",
      steps: "int",
      verifiedSteps: "int",
      declaredSteps: "int",
      unresolvedSteps: "int",
      seenSteps: "int",
      observedCoverage: "int",
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
  operation: {
    description: "One use case of an aggregate, with what its handler checks held against what its contract promises.",
    schema: {
      id: "string",
      name: "string",
      kind: "string",
      aggregate: "string",
      service: "string",
      context: "string",
      deprecated: "bool",
      exposedBy: "list<string>",
      checked: "bool",
      fields: "list<string>",
      contract: "string",
      method: "string",
      compared: "int",
      ruleDifferences: "list<string>",
      source: "string",
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
 * entry is good. `builtinIds` are the rules the package ships: an entry
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
      for (const key of ["over", "when", "message", "peer", "title", "note", "description", "action", "examples"]) {
        if (entry[key] !== undefined) problems.push(`${at}/${key}: "${entry.id}" is a built-in rule; only enabled, severity and reason may be set`);
      }
      if (entry.enabled === false && !entry.reason) problems.push(`${at}/reason: a disabled rule needs a reason`);
      return;
    }
    const expressionProblems = ruleExpressionProblems(entry, at);
    problems.push(...expressionProblems);
    if (expressionProblems.length === 0) problems.push(...ruleExampleProblems(entry, at));
  });
  return problems;
}

/** The expressions of one whole rule, checked over its subject; lines for what is wrong. */
export function ruleExpressionProblems(rule, at = rule.id) {
  const problems = [];
  if (!SUBJECT_NAMES.includes(rule.over)) return [`${at}/over: must be one of ${SUBJECT_NAMES.join(", ")}`];
  if (typeof rule.title !== "string" || !rule.title.trim()) problems.push(`${at}/title: required`);
  for (const [key, type] of [
    ["when", "bool"],
    ["message", "string"],
  ]) {
    if (typeof rule[key] !== "string" || !rule[key].trim()) {
      problems.push(`${at}/${key}: required`);
      continue;
    }
    try {
      compileExpression(rule.over, rule[key], type);
    } catch (cause) {
      problems.push(`${at}/${key}: ${firstLine(cause)}`);
    }
  }
  if (rule.peer !== undefined) {
    try {
      compileExpression(rule.over, rule.peer, "string");
    } catch (cause) {
      problems.push(`${at}/peer: ${firstLine(cause)}`);
    }
  }
  return problems;
}

function firstLine(cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.split("\n", 1)[0];
}

// ---------------------------------------------------------------------------
// Examples: a rule's own tests.
//
// An example is a row the author wrote down, or kept from the catalog, and
// what the rule should say about it: a row, or none. It carries only the
// fields the rule reads; the rest of the subject is filled with zero values,
// so a kept example does not copy a whole row into portolan.json. Beside the
// row it may carry the estate lists the rule reads, for a rule that asks
// `in estate.services`; the ones it leaves out are empty.
//
// The same function runs an example on the page and in the manifest check,
// so an example the page shows as holding is one `check` accepts.

export const EXPECTATIONS = ["row", "none"];

/** The value a field has when an example leaves it out. */
export function zeroOf(type) {
  switch (type) {
    case "int":
      return 0n;
    case "bool":
      return false;
    case "list<string>":
      return [];
    default:
      return "";
  }
}

/**
 * A written row as the expression reads it: every field of the subject, in
 * its CEL type. Refuses a field the subject does not have and a value of the
 * wrong shape, because an example that cannot be the subject tests nothing.
 */
export function rowOfExample(schema, written = {}, at = "row") {
  if (!written || typeof written !== "object" || Array.isArray(written)) throw new Error(`${at}: must be an object`);
  for (const key of Object.keys(written)) {
    if (!(key in schema)) throw new Error(`${at}/${key}: not a field of this subject`);
  }
  const row = {};
  for (const [key, type] of Object.entries(schema)) {
    const value = written[key];
    if (value === undefined) {
      row[key] = zeroOf(type);
      continue;
    }
    const wrong = () => new Error(`${at}/${key}: must be ${{ int: "an int", bool: "a bool", "list<string>": "a list of strings" }[type] ?? "a string"}`);
    if (type === "int") {
      if (typeof value === "bigint") row[key] = value;
      else if (typeof value === "number" && Number.isInteger(value)) row[key] = BigInt(value);
      else throw wrong();
    } else if (type === "bool") {
      if (typeof value !== "boolean") throw wrong();
      row[key] = value;
    } else if (type === "list<string>") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw wrong();
      row[key] = value;
    } else {
      if (typeof value !== "string") throw wrong();
      row[key] = value;
    }
  }
  return row;
}

/** Whether the rule's condition holds for one example; throws when the example or the rule cannot run. */
export function exampleMatches(over, when, example) {
  const definition = SUBJECTS[over];
  if (!definition) throw new Error(`unknown subject "${over}"`);
  const row = rowOfExample(definition.schema, example?.row, "row");
  const estate = rowOfExample(ESTATE_SCHEMA, example?.estate ?? {}, "estate");
  return compileExpression(over, when, "bool")({ [over]: row, estate }) === true;
}

/** Lines for every example of a rule that is malformed or that the rule gets wrong. */
export function ruleExampleProblems(rule, at = rule.id) {
  const examples = rule.examples;
  if (examples === undefined) return [];
  if (!Array.isArray(examples)) return [`${at}/examples: must be an array`];
  const problems = [];
  const names = new Set();
  examples.forEach((example, index) => {
    const where = `${at}/examples/${index}`;
    if (!example || typeof example !== "object") {
      problems.push(`${where}: must be an object`);
      return;
    }
    if (typeof example.name !== "string" || !example.name.trim()) problems.push(`${where}/name: required`);
    else if (names.has(example.name)) problems.push(`${where}/name: "${example.name}" appears twice`);
    else names.add(example.name);
    if (!EXPECTATIONS.includes(example.expect)) {
      problems.push(`${where}/expect: must be one of ${EXPECTATIONS.join(", ")}`);
      return;
    }
    try {
      const matched = exampleMatches(rule.over, rule.when, example);
      if (matched !== (example.expect === "row")) {
        problems.push(`${where}: "${example.name}" expects ${example.expect === "row" ? "a row" : "no row"}, the rule gives ${matched ? "a row" : "none"}`);
      }
    } catch (cause) {
      problems.push(`${where}/${firstLine(cause)}`);
    }
  });
  return problems;
}
