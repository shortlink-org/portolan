import { describe, expect, it } from "vitest";
import { classifyWarning, diagnoseWarnings, warningPolicyProblems } from "./warning-policy.mjs";

describe("warning CEL policies", () => {
  const warnings = [
    "aviacore-api: no operationId on 53 of 53 operations; listed by verb and path: GET /a, POST /b and 51 more",
    "aviasupp-api: no operationId on 2 of 9 operations; listed by verb and path: POST /book, POST /cancel",
  ];

  it("evaluates typed CEL over the diagnostic and its repetition count", () => {
    const diagnostics = diagnoseWarnings({
      plugin: "openapi",
      warnings,
      project: "aviacore",
      phase: "extract",
      policies: [{
        when: "plugin == 'openapi' && rule == 'openapi.missing-operation-id' && project == 'aviacore' && count >= 2",
        action: "suppress",
        reason: "Owned upstream.",
      }],
    });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      rule: "openapi.missing-operation-id",
      count: 2,
      project: "aviacore",
      phase: "extract",
      suppressed: true,
      suppressionReason: "Owned upstream.",
    });
  });

  it("leaves non-matching diagnostics active", () => {
    const [diagnostic] = diagnoseWarnings({
      plugin: "openapi",
      warnings: warnings.slice(0, 1),
      project: "aviasupp",
      phase: "extract",
      policies: [{ when: "project == 'aviacore'", action: "suppress", reason: "Only core." }],
    });
    expect(diagnostic?.suppressed).toBe(false);
  });

  it("reports unknown variables, syntax errors and non-boolean expressions", () => {
    expect(warningPolicyProblems([{ when: "unknown == 1" }])).toEqual([
      expect.stringContaining("Unknown variable: unknown"),
    ]);
    expect(warningPolicyProblems([{ when: "plugin ==" }])).toEqual([
      expect.stringContaining("invalid CEL"),
    ]);
    expect(warningPolicyProblems([{ when: "plugin" }])).toEqual([
      expect.stringContaining("must return bool"),
    ]);
  });
});

describe("warning classification", () => {
  // Each message is worded the way the plugin that emits it words it today
  // (grep the plugin for the phrase before editing a rule), so a policy that
  // names the rule keeps matching during generation.
  const emitted = [
    ["openapi", "aviacore-api: no operationId on 53 of 53 operations; listed by verb and path: GET /a, POST /b and 51 more", "openapi.missing-operation-id"],
    ["go-domain", "calls ledger.v1 and the manifest names no peer for that package; add it under `peers` to say which service answers, or under `externals` when the far end is outside the estate, until then the calls are unresolved", "catalog.unmapped-proto-peer"],
    ["java-domain", "calls ledger.v1 and the manifest names no peer for it; add it under `peers` to say which service answers, or under `externals` when the far end is outside the estate, until then the calls are unresolved", "catalog.unmapped-proto-peer"],
    ["go-domain", "internal/app: port `clock Clock` is neither a domain port nor a use case; its calls are left out of the flow", "flow.unknown-port"],
    ["rust-domain", "src/app.rs: port `clock: Clock` is neither a domain port, a use case nor a client; its calls are left out of the flow", "flow.unknown-port"],
    ["watermill", "internal/bus/router.go:12:3: Watermill handler orders is registered on topic `cfg.Topic`, which this reader cannot resolve to a literal, a constant, a config default or a caller's argument; the handler is kept with its topic unresolved", "watermill.unresolved-topic"],
    ["watermill", "internal/bus/cqrs.go:40:5: Watermill CQRS handler topic generator could not be resolved", "watermill.unresolved-topic"],
    ["go-nats", "internal/pub.go:8:2: subject of Publish could not be resolved to a literal, a constant, a config default or a caller's argument", "messaging.unresolved-subject"],
    ["go-sqs", "internal/relay.go:15:2: queue of SendMessage could not be resolved to a literal, a constant, a config default, a constructor's argument or a caller's argument", "messaging.unresolved-queue"],
    ["git", "github.com/acme/ledger: not fetched (offline); the copy committed in this repository is used unchanged", "source.offline-cache"],
    ["markdown", "flow.checkout step \"pay\" is unresolved: POST /pay", "flow.unresolved-step"],
    ["rust-domain", "Confirm: src/policy.rs: Confirm.handle reacts to the message named \"payment.authorized\", which no event this repository declares is called; the step is unresolved", "flow.unknown-event"],
  ];

  it.each(emitted)("classifies what %s emits to a stable rule", (plugin, message, rule) => {
    expect(classifyWarning(plugin, message).rule).toBe(rule);
  });

  it("no longer carries a rule for a warning no plugin emits", () => {
    const message = "billing/records: no model called Records, and 2 models to choose from: name the root in the aggregates option";
    expect(classifyWarning("django-domain", message).rule).toMatch(/^plugin\.django-domain\.other-/);
  });
});
