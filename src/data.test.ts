import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SOURCE_GLOBS } from "./data";

// The site cannot read the manifest: import.meta.glob resolves at build time
// and needs literals, so the patterns are written out twice - once in
// portolan.json for the host, once in data.ts for the site. This is what keeps
// the two copies one list: a source the host merges and the site never loads
// is a page that exists in docs/ and nowhere on the site.
describe("the site's source globs", () => {
  it("are the manifest's sources, in the manifest's order", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../portolan.json", import.meta.url), "utf8"),
    ) as { sources: string[] };
    expect([...SOURCE_GLOBS]).toEqual(manifest.sources);
  });
});
