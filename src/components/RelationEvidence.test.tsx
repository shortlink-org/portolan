import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RelationEvidencePanel } from "./RelationEvidence";

it("explains an ambiguous binding without choosing a candidate", () => {
  const html = renderToStaticMarkup(<RelationEvidencePanel items={[
    { kind: "binding", rule: "provider-signature", source: "di.go:12", symbol: "Build" },
    { kind: "unresolved", rule: "ambiguous-binding", candidates: ["First", "Second"] },
  ]} />);
  for (const value of ["Why this relation exists", "inferred", "di.go:12", "Several implementations remain possible", "First", "Second"]) expect(html).toContain(value);
});
it("shows the absence of evidence explicitly", () => {
  expect(renderToStaticMarkup(<RelationEvidencePanel items={[]} />)).toContain("No source evidence recorded");
});
