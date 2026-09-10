import { describe, expect, it } from "vitest";
import { groupDiagnostics, groupWarnings, warningDiagnostic } from "./warnings";

describe("warning diagnostics", () => {
  it("assigns a stable rule, severity and action to known warnings", () => {
    const diagnostic = warningDiagnostic({
      plugin: "openapi",
      message: "aviacore-api: /book POST has no operationId; listed by verb and path",
    });

    expect(diagnostic).toMatchObject({
      plugin: "openapi",
      rule: "openapi.missing-operation-id",
      severity: "warning",
      ref: "aviacore-api",
      suppressed: false,
    });
    expect(diagnostic.action).toContain("operationId");
  });

  it("groups repetitions by plugin, rule and severity", () => {
    const groups = groupWarnings([
      { plugin: "openapi", message: "api: /book POST has no operationId; listed by verb and path" },
      { plugin: "openapi", message: "api: /cancel POST has no operationId; listed by verb and path" },
      { plugin: "wsdl", message: "schema.xsd: duplicate declaration CodeType; the first declaration is used" },
    ]);

    expect(groups.map(({ plugin, rule, count }) => ({ plugin, rule, count }))).toEqual([
      { plugin: "openapi", rule: "openapi.missing-operation-id", count: 2 },
      { plugin: "wsdl", rule: "schema.duplicate-declaration", count: 1 },
    ]);
  });

  it("marks read and parse failures as errors and expected absence as info", () => {
    expect(warningDiagnostic({ plugin: "sql", message: "schema.sql could not be parsed" }).severity).toBe("error");
    expect(warningDiagnostic({ plugin: "river", message: "root: no River jobs were found" }).severity).toBe("info");
  });

  it("groups persisted policy decisions without evaluating policies in the browser", () => {
    const diagnostic = warningDiagnostic({ plugin: "openapi", message: "api: /book POST has no operationId; listed by verb and path" });
    const groups = groupDiagnostics([{ ...diagnostic, suppressed: true, suppressionReason: "Owned upstream." }]);
    expect(groups[0]).toMatchObject({ suppressed: true, suppressionReason: "Owned upstream.", count: 1 });
  });

  it("keeps unrelated unknown warnings in separate fallback rules", () => {
    const groups = groupWarnings([
      { plugin: "custom", message: "service: frobnicator needs attention" },
      { plugin: "custom", message: "service: another limitation was observed" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.rule.startsWith("plugin.custom.other-"))).toBe(true);
  });
});
