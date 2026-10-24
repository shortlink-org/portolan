import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ChangedWith } from "./ChangedWith";

describe("ChangedWith", () => {
  it("labels path ownership as impact and preserves ambiguous and unmatched paths", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ChangedWith impact={[
      { path: "scripts/gen.mjs", repository: "github.com/shortlink-org/portolan", level: "service", service: "portolan.host", servicePath: "scripts" },
      { path: "shared/config.ts", repository: "github.com/shortlink-org/portolan", level: "repository", reason: "ambiguous", candidates: ["portolan.host", "portolan.site"], servicePath: "shared" },
      { path: "README.md", repository: "github.com/shortlink-org/portolan", level: "repository", reason: "unmatched" },
    ]} /></MemoryRouter>);

    expect(html).toContain("Changed with");
    expect(html).toContain("impact, not implementation evidence");
    expect(html).toContain("scripts/gen.mjs");
    expect(html).toContain("portolan.host");
    expect(html).toContain("repository · ambiguous");
    expect(html).toContain("repository · no service path matched");
  });
});
