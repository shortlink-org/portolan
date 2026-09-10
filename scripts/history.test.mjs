import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { changedSince, fileHistory, forgetHistory, historyFor, lastCommitTouching, parseLog, stampsFor } from "./history.mjs";

const created = [];
afterEach(() => {
  forgetHistory();
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ADA = { GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "ada@example.com" };
const GRACE = { GIT_AUTHOR_NAME: "Grace Hopper", GIT_AUTHOR_EMAIL: "grace@example.com", GIT_COMMITTER_NAME: "Grace Hopper", GIT_COMMITTER_EMAIL: "grace@example.com" };

function repository() {
  const root = mkdtempSync(join(tmpdir(), "portolan-history-"));
  created.push(root);
  const git = (args, who = ADA, date = "2026-01-01T09:00:00Z") =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (name, contents) => {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
  };
  git(["init", "-q"]);
  return { root, git, write };
}

describe("historyFor", () => {
  it("gives every file its first commit, its last, and follows a move", () => {
    const { root, git, write } = repository();
    write("docs/adr/0001-first.md", "# 1. First\n");
    write("docs/adr/0002-second.md", "# 2. Second\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "two records"]);
    write("docs/adr/0002-second.md", "# 2. Second\n\nReworded.\n");
    git(["commit", "-q", "-am", "reword"], GRACE, "2026-01-03T17:30:00Z");
    mkdirSync(join(root, "adr"));
    git(["mv", "docs/adr/0001-first.md", "adr/0001-first.md"]);
    git(["commit", "-q", "-m", "move"], GRACE, "2026-01-05T08:00:00Z");

    const history = historyFor(root, ".");
    expect(Object.keys(history).sort()).toEqual(["adr/0001-first.md", "docs/adr/0002-second.md"]);

    const second = history["docs/adr/0002-second.md"];
    expect(second.created).toMatchObject({ author: "Ada Lovelace", date: "2026-01-01T09:00:00Z" });
    expect(second.created.commit).toHaveLength(40);
    expect(second.revised).toMatchObject({ author: "Grace Hopper", date: "2026-01-03T17:30:00Z" });
    expect(second.revised.commit).not.toBe(second.created.commit);

    const moved = history["adr/0001-first.md"];
    expect(moved.created).toMatchObject({ author: "Ada Lovelace", date: "2026-01-01T09:00:00Z" });
    expect(moved.revised).toMatchObject({ author: "Grace Hopper", date: "2026-01-05T08:00:00Z" });
  });

  it("keeps only the root's files, and no revision for a file committed once", () => {
    const { root, git, write } = repository();
    write("docs/adr/0001-first.md", "# 1. First\n");
    write("README.md", "# Repo\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"]);

    expect(Object.keys(historyFor(root, "docs/adr"))).toEqual(["docs/adr/0001-first.md"]);
    expect(historyFor(root, "docs/adr")["docs/adr/0001-first.md"]).not.toHaveProperty("revised");
    expect(historyFor(root, "docs")).toHaveProperty("docs/adr/0001-first.md");
  });

  it("names files as a manifest below the repository root would", () => {
    const { root, git, write } = repository();
    write("services/auth/docs/adr/0001-first.md", "# 1. First\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "one"]);

    expect(Object.keys(historyFor(join(root, "services/auth"), "docs/adr"))).toEqual(["docs/adr/0001-first.md"]);
  });

  it("answers undefined outside a checkout, and nothing for a deleted file", () => {
    const bare = mkdtempSync(join(tmpdir(), "portolan-history-bare-"));
    created.push(bare);
    expect(historyFor(bare, ".")).toBeUndefined();

    const { root, git, write } = repository();
    write("gone.md", "x\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "add"]);
    git(["rm", "-q", "gone.md"]);
    git(["commit", "-q", "-m", "remove"]);
    expect(fileHistory(root).size).toBe(0);
  });
});

describe("parseLog", () => {
  it("reads git's record, field and name-status lines", () => {
    const log = [
      "\x1eaaa\x1fAda\x1f2026-01-01T09:00:00Z\n\nA\tdocs/a.md\nA\tdocs/b.md\n",
      "\x1ebbb\x1fGrace\x1f2026-01-02T09:00:00Z\n\nM\tdocs/b.md\nR100\tdocs/a.md\tadr/a.md\nC075\tdocs/b.md\tdocs/c.md\n",
      "\x1eccc\x1fGrace\x1f2026-01-03T09:00:00Z\n\nD\tdocs/c.md\n",
    ].join("");
    const history = parseLog(log);
    expect([...history.keys()].sort()).toEqual(["adr/a.md", "docs/b.md"]);
    expect(history.get("adr/a.md")).toEqual({ created: { commit: "aaa", author: "Ada", date: "2026-01-01T09:00:00Z" }, revised: { commit: "bbb", author: "Grace", date: "2026-01-02T09:00:00Z" } });
    expect(history.get("docs/b.md").revised.commit).toBe("bbb");
  });
});
