import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { specHistory } from "./spec-history.mjs";

function git(root, args, date) {
  execFileSync("git", ["-C", root, ...args], {
    stdio: "ignore",
    env: date
      ? {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        }
      : process.env,
  });
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

describe("specHistory", () => {
  it("returns the first and latest Git event for a committed specification source", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-spec-history-"));
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.name", "Ada Lovelace"]);
    git(root, ["config", "user.email", "ada@example.test"]);

    const source = "openspec/changes/add-budget/proposal.md";
    write(root, source, "# Proposal\n");
    git(root, ["add", source]);
    git(root, ["commit", "--quiet", "-m", "add proposal"], "2026-01-02T03:04:05Z");
    const first = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    write(root, source, "# Proposal\n\nAdd a bounded budget.\n");
    git(root, ["add", source]);
    git(root, ["commit", "--quiet", "-m", "explain budget"], "2026-02-03T04:05:06Z");
    const latest = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    expect(specHistory(root, [source])).toEqual([
      {
        source,
        status: "available",
        first: { commit: first, author: "Ada Lovelace", date: "2026-01-02T03:04:05Z" },
        latest: { commit: latest, author: "Ada Lovelace", date: "2026-02-03T04:05:06Z" },
        uncommitted: false,
      },
    ]);
  });

  it("explains when a specification is outside a Git checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-spec-history-"));
    const source = "openspec/changes/add-budget/proposal.md";
    write(root, source, "# Proposal\n");

    expect(specHistory(root, [source])).toEqual([
      { source, status: "unavailable", reason: "not-a-git-repository" },
    ]);
  });

  it("distinguishes an uncommitted-only specification from missing Git", () => {
    const root = mkdtempSync(join(tmpdir(), "portolan-spec-history-"));
    git(root, ["init", "--quiet"]);
    const source = "openspec/changes/add-budget/proposal.md";
    write(root, source, "# Proposal\n");

    expect(specHistory(root, [source])).toEqual([
      { source, status: "unavailable", reason: "uncommitted-only", uncommitted: true },
    ]);
  });

  it("does not present truncated shallow history as complete", () => {
    const parent = mkdtempSync(join(tmpdir(), "portolan-spec-history-"));
    const origin = join(parent, "origin");
    mkdirSync(origin);
    git(origin, ["init", "--quiet"]);
    git(origin, ["config", "user.name", "Ada Lovelace"]);
    git(origin, ["config", "user.email", "ada@example.test"]);
    const source = "openspec/changes/add-budget/proposal.md";
    write(origin, source, "# Proposal\n");
    git(origin, ["add", source]);
    git(origin, ["commit", "--quiet", "-m", "add proposal"], "2026-01-02T03:04:05Z");
    write(origin, source, "# Proposal\n\nAdd a bounded budget.\n");
    git(origin, ["add", source]);
    git(origin, ["commit", "--quiet", "-m", "explain budget"], "2026-02-03T04:05:06Z");

    const shallow = join(parent, "shallow");
    execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${origin}`, shallow]);

    expect(specHistory(shallow, [source])).toEqual([
      { source, status: "unavailable", reason: "shallow-history", uncommitted: false },
    ]);
  });
});
