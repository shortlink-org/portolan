import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/toast", () => ({ useToastStore: () => vi.fn() }));
vi.mock("../../lib/local-api", () => ({ problemRules: vi.fn(() => new Promise(() => {})), saveProblemRules: vi.fn() }));
import { BUILTIN_RULES } from "../../lib/problem-rules";
import { RuleWorkbench } from "./RuleWorkbench";

function page(path: string, local = false) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/rules/:id" element={<RuleWorkbench local={local} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a rule's page", () => {
  it("reads a shipped rule as one sentence with its rows, and offers nothing to save", () => {
    const rule = BUILTIN_RULES[0]!;
    const html = page(`/settings/rules/${rule.id}`, true);
    expect(html).toContain("Flag every");
    expect(html).toContain(rule.title);
    expect(html).toContain("built in, switched and re-graded on the list");
    expect(html).toMatch(/aria-label="Rows to list"|Nothing in the catalog matches|Write a condition/);
    expect(html).not.toContain("Save rule");
    expect(html).not.toContain("Keep as an example");
  });

  it("starts a new rule with its title, the sentence, and a footer with no examples", () => {
    const html = page("/settings/rules/new", true);
    expect(html).toContain('placeholder="Name the rule"');
    expect(html).toContain('aria-label="Subject"');
    expect(html).toContain("Write a condition, and the service rows it matches appear here.");
    expect(html).toContain("No examples yet. Open a row and keep it as one.");
    expect(html).toContain("Reading portolan.json…");
  });

  it("says so when no rule has the id", () => {
    expect(page("/settings/rules/no-such-rule")).toContain("No rule is called");
  });
});
