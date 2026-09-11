import { describe, expect, it } from "vitest";
import { confluenceSearchUrl } from "./confluence";

describe("Confluence integration", () => {
  it("searches the whole Cloud site from a site URL", () => {
    expect(confluenceSearchUrl("https://acme.atlassian.net/wiki", "shop.oms")).toBe(
      "https://acme.atlassian.net/wiki/search?text=shop.oms",
    );
  });

  it("narrows the search to the space a Cloud URL names", () => {
    expect(
      confluenceSearchUrl(
        "https://acme.atlassian.net/wiki/spaces/ARCH/overview",
        "Order management",
      ),
    ).toBe(
      "https://acme.atlassian.net/wiki/search?text=Order+management&spaces=ARCH",
    );
  });

  it("uses the Server search page behind a context path", () => {
    expect(
      confluenceSearchUrl("https://wiki.example/confluence/display/ARCH", "shop.oms"),
    ).toBe(
      "https://wiki.example/confluence/dosearchsite.action?queryString=shop.oms&where=ARCH",
    );
    expect(confluenceSearchUrl("https://wiki.example/", "shop.oms")).toBe(
      "https://wiki.example/dosearchsite.action?queryString=shop.oms",
    );
  });

  it("offers nothing before a URL is configured or when it is unsafe", () => {
    expect(confluenceSearchUrl("", "shop.oms")).toBeNull();
    expect(confluenceSearchUrl("javascript:alert(1)", "shop.oms")).toBeNull();
  });
});
