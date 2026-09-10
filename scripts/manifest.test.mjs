// The manifest is checked against the schema the plugins describe, so these
// run against the committed schema/portolan.schema.json rather than a fixture:
// what is worth asserting is that the real document catches a real typo.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadManifest,
  parseManifest,
  readManifest,
  readManifestText,
  requireValidManifest,
  stepKeys,
} from "./manifest.mjs";

const dir = mkdtempSync(join(tmpdir(), "portolan-manifest-"));

/** Writes a manifest to a scratch file and validates it. */
function check(manifest) {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(manifest));

  return loadManifest(path).problems;
}

const good = {
  sources: ["data/*.json"],
  projects: [
    {
      id: "auth",
      name: "Authentication",
      root: "examples/auth",
      context: "auth",
      service: "auth",
    },
  ],
  plugins: [{ name: "go-domain", process: { command: "go", args: ["run", "./plugins/extract-go"] } }],
  extract: [
    {
      plugin: "go-domain",
      in: "examples/auth",
      out: "examples/auth/portolan",
      options: { context: "auth", contextSummary: "Who someone is." },
    },
  ],
};

describe("the manifest schema", () => {
  it("accepts the manifest this repository ships", () => {
    expect(loadManifest("portolan.json").problems).toEqual([]);
  });

  it("accepts a well-formed manifest", () => {
    expect(check(good)).toEqual([]);
  });

  it("accepts a typed CEL warning policy only with an action and reason", () => {
    expect(check({
      ...good,
      warningPolicies: [{
        when: "plugin == 'openapi' && rule == 'openapi.missing-operation-id' && count > 10",
        action: "suppress",
        reason: "The contract is owned upstream.",
      }],
    })).toEqual([]);

    const problems = check({
      ...good,
      warningPolicies: [{ when: "plugin == 'openapi'", action: "suppress" }],
    });
    expect(problems.join("\n")).toContain('warningPolicies/0: "reason" is missing');
  });

  it("refuses a CEL warning policy with unknown variables or a non-boolean result", () => {
    expect(check({ ...good, warningPolicies: [{ when: "owner == 'team'", action: "suppress", reason: "test" }] }).join("\n"))
      .toContain("Unknown variable: owner");
    expect(check({ ...good, warningPolicies: [{ when: "plugin", action: "suppress", reason: "test" }] }).join("\n"))
      .toContain("CEL expression must return bool");
  });

  it("refuses an unstable project id", () => {
    const problems = check({
      ...good,
      projects: [{ ...good.projects[0], id: "Auth Service" }],
    });

    expect(problems.join("\n")).toContain("projects/0/id");
  });

  it("names the option a typo was probably meant to be", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { context: "auth", contextSummry: "..." } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("contextSummry");
    expect(problems[0]).toContain('did you mean "contextSummary"');
  });

  it("lists the known options when a key resembles nothing", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { database: "pg" } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain("did you mean");
    expect(problems[0]).toContain("known: context,");
  });

  it("refuses an option whose value is not one the plugin accepts", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { classification: "essential" } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("core, supporting, generic");
  });

  it("refuses a renderer where an extractor goes", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], plugin: "markdown" }],
    });

    expect(problems.join("\n")).toContain("go-domain");
  });

  it("refuses a step that names no output", () => {
    const { out, ...step } = good.extract[0];
    const problems = check({ ...good, extract: [step] });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('extract/0: "out" is missing');
  });

  it("parses manifest text through the same validator", () => {
    expect(parseManifest(JSON.stringify(good), "from-git:portolan.json").problems).toEqual([]);
  });

  it("gives runtime callers only a valid manifest", () => {
    const path = join(dir, "good.json");
    writeFileSync(path, JSON.stringify(good));
    expect(readManifest(path)).toEqual(good);
    expect(readManifestText(JSON.stringify(good), "memory:portolan.json")).toEqual(good);

    expect(() => requireValidManifest({
      manifest: {},
      problems: ['portolan.json: "sources" is missing'],
    })).toThrow('portolan.json: "sources" is missing');
  });
});

describe("stepKeys", () => {
  const step = (plugin, out, options) => ({ plugin, in: "svc", out, options });

  it("keys a step by its plugin while it is the only one of that plugin in its directory", () => {
    const go = step("go-domain", "svc/portolan", { out: "domain.json" });
    const api = step("openapi", "svc/portolan", { out: "api.json" });
    const keys = stepKeys({ extract: [go, api] });

    expect(keys.keyOf(go)).toBe("go-domain");
    expect(keys.keyOf(api)).toBe("openapi");
    expect([...keys.liveIn("svc/portolan/")]).toEqual(["go-domain", "openapi"]);
  });

  it("tells two steps of one plugin in one directory apart by the file they name", () => {
    const own = step("openapi", "svc/portolan", { out: "api.json" });
    const vendored = step("openapi", "svc/portolan", { external: "psp", out: "psp.json" });
    const elsewhere = step("openapi", "other/portolan", { out: "api.json" });
    const keys = stepKeys({ extract: [own, vendored, elsewhere] });

    expect(keys.keyOf(own)).toBe("openapi:api.json");
    expect(keys.keyOf(vendored)).toBe("openapi:psp.json");
    expect(keys.keyOf(elsewhere)).toBe("openapi");
  });

  it("refuses two steps that would write the same file", () => {
    const manifest = {
      generate: [step("markdown", "docs", { title: "A" }), step("markdown", "docs", { title: "B" })],
    };
    expect(() => stepKeys(manifest)).toThrow("nothing in their options tells them apart");

    const same = {
      extract: [step("openapi", "svc/portolan", { out: "api.json" }), step("openapi", "svc/portolan", { out: "api.json" })],
    };
    expect(() => stepKeys(same)).toThrow("two of them name api.json");
  });
});
