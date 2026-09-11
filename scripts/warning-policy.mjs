import { Environment } from "@marcbachmann/cel-js";

const ENVIRONMENT = new Environment({
  unlistedVariablesAreDyn: false,
  limits: {
    maxAstNodes: 256,
    maxDepth: 32,
    maxListElements: 32,
    maxMapEntries: 32,
    maxCallArguments: 8,
  },
})
  .registerVariable("plugin", "string")
  .registerVariable("rule", "string")
  .registerVariable("severity", "string")
  .registerVariable("project", "string")
  .registerVariable("phase", "string")
  .registerVariable("ref", "string")
  .registerVariable("message", "string")
  .registerVariable("count", "int");
const COMPILED = new Map();

const RULES = [
  rule("openapi.missing-operation-id", /\bno operationId\b/i, "warning", "Add stable operationId values to the OpenAPI operations."),
  rule("schema.duplicate-declaration", /\bduplicate declaration\b/i, "warning", "Remove or reconcile duplicate schema declarations; Portolan currently uses the first."),
  rule("analysis.typed-fallback", /\btyped call graph unavailable\b/i, "warning", "Run an extractor build with typed analysis support or inspect calls found by the syntax fallback."),
  rule("catalog.unresolved-call", /\bcalls .+ which nothing in this catalog resolves\b/i, "warning", "Add or correct the provider contract, then regenerate to resolve the call."),
  rule("catalog.unmapped-proto-peer", /\bmanifest names no peer for (?:that package|it)\b/i, "warning", "Map the protobuf package under peers, or declare it under externals."),
  rule("flow.unresolved-step", /\bstep .+ is unresolved\b/i, "warning", "Declare the referenced endpoint, message, or store so this flow step can be joined."),
  rule("flow.unknown-port", /\bis neither a domain port(?:,| nor) a use case\b/i, "warning", "Model this dependency as a domain port or use case, or accept that its calls stay outside the flow."),
  rule("flow.unreached-event", /\bno flow reaches this event\b/i, "warning", "Connect the event to its publisher flow or remove the stale event declaration."),
  rule("flow.unknown-event", /\breacts to the message named .+ which no event .+ declares is called\b/i, "warning", "Declare the event name used by the handler or correct the handler mapping."),
  rule("django.invalid-aggregate-root", /\baggregates names .+ and no model there is called that\b/i, "warning", "Choose an existing concrete model for the application's aggregates option."),
  rule("django.unknown-http-verb", /\bmounted as an HTTP view, but no HTTP verb is declared\b/i, "warning", "Declare the accepted HTTP methods on the view or route."),
  rule("river.missing-worker", /\bno registered Worker\b/i, "warning", "Register the River worker in this component or remove the unmatched insert."),
  rule("watermill.unresolved-topic", /\bWatermill .+\btopic (?:generator could not be resolved|unresolved)\b/i, "warning", "Use a literal, constant, or configuration default for the Watermill topic."),
  rule("messaging.unresolved-subject", /\bsubject of .+ could not be resolved\b/i, "warning", "Use a literal, constant, configuration default, or visible caller argument for the subject."),
  rule("messaging.unresolved-queue", /\bqueue of .+ could not be resolved\b/i, "warning", "Use a literal, constant, configuration default, constructor argument, or visible caller argument for the queue."),
  rule("terraform.unresolved-name", /\b(?:could not be resolved to a literal, a variable default, a local or a module argument|is named with \w+_prefix, so its name is decided at apply time|sets no \w+, so its name is decided at apply time)\b/i, "warning", "Name the resource with a literal, a variable default, a local or a module argument so the catalog can address it."),
  rule("terraform.name-at-apply-time", /\bis `[^`]*`, with .+ decided at apply time\b/i, "info", "The literal part of the name is listed; the rest is filled when Terraform applies."),
  rule("terraform.unresolved-reference", /\bcould not be followed to (?:a queue, a table or a stream|an? \w+(?: \w+)*) declared here\b/i, "warning", "Reference the resource by its Terraform address, or declare it in this module."),
  rule("terraform.module-skipped", /\bmodule ".+" (?:comes from|calls) .+ and is not read\b/i, "info", "Vendor the module under the input root to have its resources read."),
  rule("terraform.not-read", /\bis not read: .+ is not part of this reader yet\b/i, "info", "This AWS product is not modelled yet; the resource is listed so the gap is visible."),
  rule("store.external-migrations", /\bmigrations are applied from .+ whose schema is not in this tree\b/i, "warning", "Vendor or expose the external migrations so their tables can be included in the store."),
  rule("store.missing-foreign-table", /\bcolumn .+ references .+ which no migration here creates\b/i, "warning", "Include the referenced table migration or correct the foreign-key target."),
  rule("schema.unresolved-type", /\bis not declared in the protos read here\b/i, "warning", "Include the imported protobuf declaration or map the type to an external schema."),
  rule("source.offline-cache", /\bnot (?:fetched|read) \(offline\)/i, "info", "Regenerate with network access when the vendored copy must be refreshed."),
  rule("source.unreachable", /\bnot (?:fetched|read) \((?!offline\))/i, "warning", "The far end could not be reached and the committed copy was used; check the server and the credential, then regenerate."),
  rule("source.unpinned", /\bnot pinned\b/i, "warning", "Pin the source to an immutable commit or schema version."),
  rule("source.parse-failed", /\bcould not (?:be read|parse|be parsed|be encoded)\b/i, "error", "Open the referenced source and fix the parse or read error."),
  rule("extraction.no-match", /\b(?:no .+ (?:was|were) found|no .+ matched|declares no |no models in this application)\b/i, "info", "Confirm this capability is absent, or point the extractor at the source that declares it."),
];

const FALLBACK_ACTION = "Inspect the referenced source and either fix the extraction gap or add a reviewed CEL policy with a reason.";

/**
 * Classify, count and apply CEL policies to one step's raw warnings.
 * Policy evaluation happens here, while the build still has its manifest;
 * deployed sites receive decisions, not an expression runtime.
 */
export function diagnoseWarnings({ plugin, warnings, policies = [], project = "", phase = "" }) {
  const diagnostics = warnings.map((message) => classifyWarning(plugin, message));
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.plugin}\0${diagnostic.rule}\0${diagnostic.severity}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const compiled = policies.map((policy) => ({ ...policy, expression: compilePolicy(policy.when) }));

  return diagnostics.map((diagnostic) => {
    const count = counts.get(`${diagnostic.plugin}\0${diagnostic.rule}\0${diagnostic.severity}`) ?? 1;
    const context = {
      plugin: diagnostic.plugin,
      rule: diagnostic.rule,
      severity: diagnostic.severity,
      project,
      phase,
      ref: diagnostic.ref ?? "",
      message: diagnostic.message,
      count: BigInt(count),
    };
    const matched = compiled.find((policy) => policy.action === "suppress" && policy.expression(context) === true);
    return {
      ...diagnostic,
      count,
      project,
      phase,
      suppressed: Boolean(matched),
      ...(matched ? { suppressionReason: matched.reason } : {}),
    };
  });
}

/** Validate CEL syntax, names and the boolean result type while reading the manifest. */
export function warningPolicyProblems(policies, path = "portolan.json") {
  const problems = [];
  for (const [index, policy] of (Array.isArray(policies) ? policies : []).entries()) {
    if (!policy || typeof policy !== "object" || typeof policy.when !== "string") continue;
    try {
      compilePolicy(policy.when);
    } catch (cause) {
      problems.push(`${path} warningPolicies/${index}/when: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return problems;
}

export function classifyWarning(plugin, message) {
  const definition = RULES.find((candidate) => candidate.matches.test(message));
  const ref = warningRef(message);
  return {
    plugin,
    message,
    rule: definition?.id ?? `plugin.${slug(plugin)}.other-${fingerprint(message)}`,
    severity: definition?.severity ?? "warning",
    action: definition?.action ?? FALLBACK_ACTION,
    ...(ref ? { ref } : {}),
  };
}

function compilePolicy(source) {
  if (COMPILED.has(source)) return COMPILED.get(source);
  let expression;
  try {
    expression = ENVIRONMENT.parse(source);
  } catch (cause) {
    throw new Error(`invalid CEL: ${cause instanceof Error ? firstLine(cause.message) : String(cause)}`);
  }
  const checked = expression.check();
  if (!checked.valid) throw new Error(`invalid CEL: ${firstLine(checked.error?.message ?? "type check failed")}`);
  if (checked.type !== "bool") throw new Error(`CEL expression must return bool, got ${checked.type}`);
  COMPILED.set(source, expression);
  return expression;
}

function rule(id, matches, severity, action) {
  return { id, matches, severity, action };
}

function warningRef(message) {
  const match = message.match(/^(.+?):\s+(?=[A-Za-z/])/);
  return match?.[1]?.trim() || undefined;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function fingerprint(message) {
  const ref = warningRef(message);
  const body = (ref ? message.slice(message.indexOf(":", ref.length) + 1) : message)
    .toLowerCase()
    .replace(/`[^`]*`|"[^"]*"|'[^']*'/g, "<value>")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function firstLine(message) {
  return String(message).split("\n", 1)[0];
}
