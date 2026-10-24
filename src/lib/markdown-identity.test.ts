import { describe, expect, it } from "vitest";
import { leadingMarkdownSummary, stripLeadingMarkdownIdentity } from "./markdown-identity";

describe("stripLeadingMarkdownIdentity", () => {
  it("removes a matching title and summary", () => {
    expect(
      stripLeadingMarkdownIdentity(
        "# Site\n\nThe browser renders the estate.\n\n## What it does\n\nReads evidence.",
        "Site",
        "The browser renders the estate.",
      ),
    ).toBe("## What it does\n\nReads evidence.");
  });

  it("keeps authored content that does not duplicate the page identity", () => {
    const markdown = "# Operating notes\n\nKeep the generated catalog immutable.";
    expect(stripLeadingMarkdownIdentity(markdown, "Site", "A browser app.")).toBe(markdown);
  });

  it("matches harmless inline markdown in the duplicated identity", () => {
    expect(stripLeadingMarkdownIdentity("# **Site**\n\nA `browser` app.", "Site", "A browser app.")).toBe("");
  });

  it("extracts the first prose paragraph as the entity summary", () => {
    expect(leadingMarkdownSummary("# Site\n\nA **browser** app.\n\n## Layout", "Site")).toBe("A browser app.");
    expect(leadingMarkdownSummary("# Site\n\n## Layout", "Site")).toBeNull();
  });
});
