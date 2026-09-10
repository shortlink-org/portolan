// The provenance of a source is the history's (portolan.0010): the commit
// that last changed the file, read off the checkout and never written in.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { changedSince, forgetHistory, lastCommitTouching, stampsFor } from "./history.mjs";
import { provenance } from "./provenance.mjs";

const created = [];
afterEach(() => {
  forgetHistory();
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ADA = { GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "ada@example.com" };

function repository() {
  const root = mkdtempSync(join(tmpdir(), "portolan-provenance-"));
  created.push(root);
  const git = (args, date = "2026-01-01T09:00:00Z") =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...ADA, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (name, contents) => {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
  };
  git(["init", "-q"]);
  return { root, git, write };
}

function elsewhere() {
  const dir = mkdtempSync(join(tmpdir(), "portolan-no-repo-"));
  created.push(dir);
  return dir;
}

describe("stampsFor", () => {
  // The stamp is the commit the change landed in, which is what a stamp
  // written into the file could never say.
  it("dates a source by the commit that last changed it", () => {
    const { root, git, write } = repository();
    write("portolan/domain.json", "{}\n");
    write("portolan/api.json", "{}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "both"], "2026-01-01T09:00:00Z");
    write("portolan/domain.json", '{"changed":true}\n');
    git(["add", "."]);
    git(["commit", "-q", "-m", "domain again"], "2026-02-02T10:00:00Z");
    const second = git(["rev-parse", "--short=7", "HEAD"]);
    const first = git(["rev-parse", "--short=7", "HEAD~1"]);

    const stamps = stampsFor(root, ["portolan/domain.json", "portolan/api.json"]);
    expect(stamps.get("portolan/domain.json")).toEqual({ commit: second, generatedAt: "2026-02-02T10:00:00Z" });
    expect(stamps.get("portolan/api.json")).toEqual({ commit: first, generatedAt: "2026-01-01T09:00:00Z" });
  });

  it("calls a modified, an untracked and an unversioned file uncommitted, dated by the working tree", () => {
    const { root, git, write } = repository();
    write("portolan/domain.json", "{}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"]);
    write("portolan/domain.json", '{"dirty":true}\n');
    write("portolan/new.json", "{}\n");
    const outside = elsewhere();
    writeFileSync(join(outside, "authored.json"), "{}\n");

    const stamps = stampsFor(root, ["portolan/domain.json", "portolan/new.json", join(outside, "authored.json")]);
    expect(stamps.size).toBe(3);
    for (const stamp of stamps.values()) {
      expect(stamp.commit).toBe("uncommitted");
      expect(Number.isNaN(Date.parse(stamp.generatedAt))).toBe(false);
    }
  });
});

describe("what changed since the output was last committed", () => {
  it("lists the inputs that moved, working tree included, and leaves the output directory out", () => {
    const { root, git, write } = repository();
    write("svc/main.go", "package main\n");
    write("svc/go.mod", "module svc\n");
    write("svc/portolan/domain.json", "{}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "generated"], "2026-01-01T09:00:00Z");
    const generated = git(["rev-parse", "--short=7", "HEAD"]);
    write("svc/main.go", "package main // changed\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "source moved"], "2026-02-02T10:00:00Z");
    write("svc/go.mod", "module svc // dirty\n");
    write("svc/new.go", "package main\n");
    write("svc/portolan/domain.json", '{"regenerated":true}\n');

    expect(lastCommitTouching(root, ["svc/portolan/domain.json"])).toEqual({ commit: generated, date: "2026-01-01T09:00:00Z" });
    expect(changedSince(root, generated, ["svc"], ["svc/portolan"])).toEqual(["svc/go.mod", "svc/main.go", "svc/new.go"]);
    expect(changedSince(root, generated, ["svc"])).toContain("svc/portolan/domain.json");
  });

  it("answers null for an output nobody has committed, and nothing outside a repository", () => {
    const { root, write } = repository();
    write("svc/portolan/domain.json", "{}\n");
    expect(lastCommitTouching(root, ["svc/portolan/domain.json"])).toBeNull();
    const outside = elsewhere();
    expect(lastCommitTouching(outside, ["x.json"])).toBeNull();
    expect(changedSince(outside, "HEAD", ["."])).toEqual([]);
  });
});

describe("the site's provenance module", () => {
  it("stamps every source the manifest's patterns find, keyed as the manifest spells them", () => {
    const { root, git, write } = repository();
    write("portolan.json", JSON.stringify({ sources: ["portolan/*.json", "services/*/portolan/*.json"] }));
    write("portolan/host.json", "{}\n");
    write("services/oms/portolan/domain.json", "{}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"], "2026-03-03T03:00:00Z");
    const head = git(["rev-parse", "--short=7", "HEAD"]);

    expect(provenance(root)).toEqual({
      "portolan/host.json": { commit: head, generatedAt: "2026-03-03T03:00:00Z" },
      "services/oms/portolan/domain.json": { commit: head, generatedAt: "2026-03-03T03:00:00Z" },
    });
  });

  // A staged site imports flattened copies. The stamp is the workspace file's,
  // keyed by the name the browser imports, and it says which file that was -
  // the path a project's root is a prefix of.
  it("keys a staged site's sources by their flattened names and says where each came from", () => {
    const { root, git, write } = repository();
    write("portolan.json", JSON.stringify({ sources: ["services/*/portolan/*.json"] }));
    write("services/oms/portolan/domain.json", "{}\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"], "2026-03-03T03:00:00Z");
    const head = git(["rev-parse", "--short=7", "HEAD"]);
    const stage = join(root, ".portolan", "site");
    write(".portolan/site/.portolan/source-paths.json", JSON.stringify({
      "portolan/source-0001.json": "services/oms/portolan/domain.json",
    }));

    expect(provenance(root, stage)).toEqual({
      "portolan/source-0001.json": { commit: head, generatedAt: "2026-03-03T03:00:00Z", source: "services/oms/portolan/domain.json" },
    });
  });
});
