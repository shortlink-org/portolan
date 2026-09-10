import { describe, expect, it } from "vitest";
import { diagnoseWarnings, warningPolicyProblems } from "./warning-policy.mjs";

describe("warning CEL policies", () => {
  const warnings = [
    "api: /book POST has no operationId; listed by verb and path",
    "api: /cancel POST has no operationId; listed by verb and path",
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
