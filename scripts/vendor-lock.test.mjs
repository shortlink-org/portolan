import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vendoredCommit } from "./vendor-lock.mjs";

const COMMIT = "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0";

describe("vendoredCommit", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "portolan-vendor-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const copy = (at, lock) => {
    mkdirSync(join(root, at), { recursive: true });
    writeFileSync(join(root, at, "git.lock.json"), JSON.stringify(lock));
  };

  // The case this exists for: the extractor is pointed at a service some way
  // inside the copy, and the lock is at the copy's root.
  it("reads the lock above the directory the extractor was given", () => {
    copy("vendor/repos/acme/shop", { repos: [{ repo: "github.com/acme/shop", commit: COMMIT }] });
    mkdirSync(join(root, "vendor/repos/acme/shop/services/oms"), { recursive: true });

    expect(vendoredCommit(join(root, "vendor/repos/acme/shop/services/oms"))).toBe(COMMIT);
  });

  it("answers null for a directory that is nobody's copy", () => {
    mkdirSync(join(root, "examples/shop/oms"), { recursive: true });

    expect(vendoredCommit(join(root, "examples/shop/oms"))).toBeNull();
  });

  // The fetcher writes one repository per directory. Anything else is its
  // problem to report, with the path and the count; a stamp is not worth
  // failing a run over, so this stops rather than guessing which one won.
  it("answers null for a lock naming more than one repository", () => {
    copy("vendor/repos/acme/shop", {
      repos: [
        { repo: "github.com/acme/shop", commit: COMMIT },
        { repo: "github.com/acme/pay", commit: "0000000" },
      ],
    });

    expect(vendoredCommit(join(root, "vendor/repos/acme/shop"))).toBeNull();
  });

  it("answers null for a lock that cannot be read", () => {
    mkdirSync(join(root, "vendor/repos/acme/shop"), { recursive: true });
    writeFileSync(join(root, "vendor/repos/acme/shop/git.lock.json"), "{ not json");

    expect(vendoredCommit(join(root, "vendor/repos/acme/shop"))).toBeNull();
  });

  // A copy nested inside another copy takes the innermost lock: it is the one
  // that names the files the extractor is about to read.
  it("takes the nearest lock", () => {
    copy("vendor/repos/acme", { repos: [{ repo: "github.com/acme/outer", commit: "9999999" }] });
    copy("vendor/repos/acme/shop", { repos: [{ repo: "github.com/acme/shop", commit: COMMIT }] });

    expect(vendoredCommit(join(root, "vendor/repos/acme/shop"))).toBe(COMMIT);
  });
});
