import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocsLinksContent } from "./DocsLinks";

describe("DocsLinks", () => {
  it("searches Confluence by name and opens the Notion workspace", () => {
    const markup = renderToStaticMarkup(
      <DocsLinksContent
        name="shop.oms"
        confluence="https://acme.atlassian.net/wiki/spaces/ARCH"
        notion="https://www.notion.so/acme"
      />,
    );
    expect(markup).toContain("view in Confluence");
    expect(markup).toContain(
      'href="https://acme.atlassian.net/wiki/search?text=shop.oms&amp;spaces=ARCH"',
    );
    expect(markup).toContain("open Notion");
    expect(markup).toContain('href="https://www.notion.so/acme"');
  });

  it("renders nothing before either integration is configured", () => {
    expect(
      renderToStaticMarkup(<DocsLinksContent name="shop.oms" confluence="" notion="" />),
    ).toBe("");
  });
});
