import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cloneOf, deleteDraft, discardDraft, draftPath, fetchClone, generateDraft, listBranches, listDrafts, pendingPath, projectSteps, projectsTouched, readDrafts, readPending, restoreDraft, saveDraft, touchedBy, validBranch, vendorOf } from "./branch-drafts.mjs";

const created = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ADA = { GIT_AUTHOR_NAME: "Ada Lovelace", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada Lovelace", GIT_COMMITTER_EMAIL: "ada@example.com" };

function repository() {
  const root = mkdtempSync(join(tmpdir(), "portolan-drafts-"));
  created.push(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...ADA }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (name, contents, message = name) => {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents);
    git("add", ".");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  return { root, git, commit };
}

const PROJECTS = [
  { id: "portolan", root: "." },
  { id: "auth", root: "examples/auth" },
  { id: "cart", root: "examples/shop/cart" },
];

describe("draftPath", () => {
  it("keeps one file per project and branch, a slash spelled as git never spells one", () => {
    expect(draftPath("auth", "demo/auth-passkeys")).toBe(join("portolan-drafts", "auth", "demo~auth-passkeys.json"));
  });

  it("refuses a project or branch that could leave the drafts folder", () => {
    expect(() => draftPath("../auth", "demo")).toThrowError(/project id/);
    expect(() => draftPath("auth", "../../etc")).toThrowError(/branch name/);
    expect(() => draftPath("auth", "")).toThrowError(/branch name/);
  });
});

describe("validBranch", () => {
  it("accepts what git accepts and refuses what it refuses", () => {
    for (const name of ["main", "demo/auth-passkeys", "renovate/ai-7.x", "feature_1"]) expect(validBranch(name)).toBe(true);
    for (const name of ["-x", "a..b", "a b", "a~b", "a:b", "/a", "a/", "a.lock", "a@{1}", "a//b"]) expect(validBranch(name)).toBe(false);
  });
});

describe("projectsTouched", () => {
  it("gives a path to the most specific project whose root holds it", () => {
    expect(projectsTouched(PROJECTS, ["examples/auth/go.mod", "examples/shop/cart/src/a.ts", "README.md"])).toEqual(["auth", "cart", "portolan"]);
    expect(projectsTouched(PROJECTS, ["examples/authz/x"])).toEqual(["portolan"]);
  });
});

describe("projectSteps", () => {
  it("picks a phase's steps by the project their input falls in", () => {
    const manifest = {
      projects: PROJECTS,
      extract: [
        { plugin: "go-domain", in: "examples/auth", out: "examples/auth/portolan" },
        { plugin: "adr", in: "adr", out: "portolan" },
        { plugin: "ts-domain", in: "examples/shop/cart/", out: "examples/shop/cart/portolan" },
      ],
      verify: [{ plugin: "otel", in: "examples/auth", out: "examples/auth/portolan" }],
    };
    expect(projectSteps(manifest, "auth").map((step) => step.plugin)).toEqual(["go-domain"]);
    expect(projectSteps(manifest, "cart").map((step) => step.plugin)).toEqual(["ts-domain"]);
    expect(projectSteps(manifest, "portolan").map((step) => step.plugin)).toEqual(["adr"]);
    expect(projectSteps(manifest, "auth", "verify").map((step) => step.plugin)).toEqual(["otel"]);
  });
});

describe("branches and saved drafts", { timeout: 30_000 }, () => {
  it("lists branches main does not contain, with the projects they touch", () => {
    const { root, git, commit } = repository();
    const base = commit("examples/auth/a.go", "package a\n");
    git("branch", "merged");
    git("switch", "-q", "-c", "demo/passkeys");
    const tip = commit("examples/auth/b.go", "package a\n");
    git("switch", "-q", "main");
    commit("README.md", "main moves on\n");

    const { main, branches, projects } = listBranches(root, { projects: PROJECTS });
    expect(main).toBe("main");
    expect(branches).toEqual([{ branch: "demo/passkeys", tip, base, ahead: 1, main: "main", projects: ["auth"] }]);
    expect(projects.map((project) => project.id)).toEqual(["portolan", "auth", "cart"]);
  });

  it("says whether a saved draft's branch is where it was, moved or gone, and deletes it", () => {
    const { root, git, commit } = repository();
    commit("examples/auth/a.go", "package a\n");
    git("switch", "-q", "-c", "demo/passkeys");
    const tip = commit("examples/auth/b.go", "package a\n");
    git("switch", "-q", "-c", "demo/gone");
    const goneTip = commit("examples/auth/c.go", "package a\n");
    git("switch", "-q", "main");

    const save = (branch, draftTip) => {
      const file = join(root, draftPath("auth", branch));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ schema: "portolan.draft/v1", project: "auth", branch, tip: draftTip, base: "b", generatedAt: "2026-09-15T00:00:00Z", entities: [{ kind: "flow", id: "f", change: "added" }] }));
    };
    save("demo/passkeys", tip);
    save("demo/gone", goneTip);
    git("branch", "-D", "demo/gone");

    expect(listDrafts(root).map(({ branch, status, entities }) => ({ branch, status, entities }))).toEqual([
      { branch: "demo/gone", status: "gone", entities: 1 },
      { branch: "demo/passkeys", status: "fresh", entities: 1 },
    ]);

    git("switch", "-q", "demo/passkeys");
    const moved = commit("examples/auth/d.go", "package a\n");
    expect(listDrafts(root).find((draft) => draft.branch === "demo/passkeys")).toMatchObject({ status: "moved", currentTip: moved });

    expect(deleteDraft(root, { project: "auth", branch: "demo/gone" })).toBe(true);
    expect(deleteDraft(root, { project: "auth", branch: "demo/passkeys" })).toBe(true);
    expect(deleteDraft(root, { project: "auth", branch: "demo/passkeys" })).toBe(false);
    expect(existsSync(join(root, "portolan-drafts", "auth"))).toBe(false);

    // A deletion keeps the draft aside until it is undone.
    restoreDraft(root, { project: "auth", branch: "demo/passkeys" });
    expect(listDrafts(root).map((draft) => draft.branch)).toEqual(["demo/passkeys"]);
  });

  it("reports a saved draft failed when its branch cannot be regenerated, until it is regenerated or deleted", async () => {
    const { root, git, commit } = repository();
    commit("examples/auth/a.go", "package a\n");
    git("switch", "-q", "-c", "demo/mfa");
    const tip = commit("examples/auth/b.go", "package a\n");
    git("switch", "-q", "main");
    const file = join(root, draftPath("auth", "demo/mfa"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ project: "auth", branch: "demo/mfa", tip, base: "b", generatedAt: "2026-09-15T00:00:00Z", entities: [] }));
    git("merge", "-q", "--ff-only", "demo/mfa");

    await expect(generateDraft(root, { project: "auth", branch: "demo/mfa", pending: true })).rejects.toThrowError(/already contains demo\/mfa/);
    const [failed] = listDrafts(root);
    expect(failed).toMatchObject({ branch: "demo/mfa", status: "failed", failure: { message: "main already contains demo/mfa; there is nothing to draft" } });
    expect(failed.failure.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The draft on disk is untouched: a failed run writes nothing but the failure.
    expect(readDrafts(root).map((draft) => draft.tip)).toEqual([tip]);
    deleteDraft(root, { project: "auth", branch: "demo/mfa" });
    restoreDraft(root, { project: "auth", branch: "demo/mfa" });
    expect(listDrafts(root)[0].status).toBe("fresh");
  });

  it("keeps a generated draft pending until it is saved over the old one or discarded", () => {
    const { root } = repository();
    const pending = join(root, pendingPath("auth", "demo/passkeys"));
    const write = (tip) => {
      mkdirSync(join(pending, ".."), { recursive: true });
      writeFileSync(pending, JSON.stringify({ project: "auth", branch: "demo/passkeys", tip, entities: [] }));
    };
    write("one");
    expect(readPending(root, { project: "auth", branch: "demo/passkeys" })).toMatchObject({ tip: "one" });
    saveDraft(root, { project: "auth", branch: "demo/passkeys" });
    expect(readDrafts(root).map((draft) => draft.tip)).toEqual(["one"]);

    write("two");
    expect(discardDraft(root, { project: "auth", branch: "demo/passkeys" })).toBe(true);
    expect(readPending(root, { project: "auth", branch: "demo/passkeys" })).toBeNull();
    expect(readDrafts(root).map((draft) => draft.tip)).toEqual(["one"]);
  });
});

// ---------------------------------------------------------------------------
// A project that lives in another repository (portolan.0029)

const VENDORED = {
  sources: ["vendor/repos/**/portolan/*.json"],
  projects: [
    { id: "aviacore", name: "Aviacore", root: "vendor/repos/avia/aviacore", repository: "git@gitlab.example.com:avia/aviacore.git", clone: "../aviacore" },
    { id: "docs", name: "Docs", root: "docs" },
  ],
  plugins: [{ name: "git", host: "fetch-git" }],
  extract: [
    {
      plugin: "git",
      in: "vendor",
      out: "vendor/repos",
      options: { cache: "vendor/repos", repos: [{ repo: "git@gitlab.example.com:avia/aviacore.git", commit: "0".repeat(40), paths: ["internal"] }] },
    },
  ],
};

/** A workspace whose one service is vendored, with the clone beside it. */
function estate() {
  const holder = mkdtempSync(join(tmpdir(), "portolan-vendored-"));
  created.push(holder);
  const make = (name) => {
    const root = join(holder, name);
    mkdirSync(root, { recursive: true });
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...ADA }, stdio: ["ignore", "pipe", "pipe"] }).trim();
    const commit = (file, contents, message = file) => {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), contents);
      git("add", ".");
      git("commit", "-q", "-m", message);
      return git("rev-parse", "HEAD");
    };
    return { root, git, commit };
  };

  const clone = make("aviacore");
  clone.git("init", "-q", "-b", "master");
  clone.commit("internal/app/a.go", "package app\n");

  const workspace = make("portolan");
  workspace.git("init", "-q", "-b", "main");
  writeFileSync(join(workspace.root, "portolan.json"), `${JSON.stringify(VENDORED, null, 2)}\n`);
  workspace.commit("vendor/repos/avia/aviacore/internal/app/a.go", "package app\n", "vendor aviacore");
  return { workspace, clone };
}

describe("a project vendored from another repository", { timeout: 30_000 }, () => {
  it("finds the clone and the fetch entry whose copy is the project's root", () => {
    const [aviacore, docs] = VENDORED.projects;
    expect(cloneOf("/w", aviacore)).toBe(join("/w", "..", "aviacore"));
    expect(cloneOf("/w", docs)).toBe("");
    expect(vendorOf(VENDORED, aviacore)?.want.repo).toBe("git@gitlab.example.com:avia/aviacore.git");
    expect(vendorOf(VENDORED, docs)).toBeNull();
  });

  it("lists the clone's branches against the clone's own main, and only what the snapshot takes", () => {
    const { workspace, clone } = estate();
    clone.git("switch", "-q", "-c", "ASUP-976");
    const tip = clone.commit("internal/app/b.go", "package app\n");
    const base = clone.git("rev-parse", "master");
    clone.git("switch", "-q", "-c", "chore/ci", "master");
    clone.commit(".gitlab-ci.yml", "stages: []\n");
    clone.git("switch", "-q", "master");

    const { main, branches } = listBranches(workspace.root, VENDORED);
    // The workspace's own main, and each branch ahead of the main of the
    // repository it is in.
    expect(main).toBe("main");
    expect(branches).toEqual([
      { branch: "ASUP-976", tip, base, ahead: 1, main: "master", projects: ["aviacore"] },
      // Outside the paths the snapshot takes: nothing in the catalog to draft.
      { branch: "chore/ci", tip: expect.any(String), base, ahead: 1, main: "master", projects: [] },
    ]);
  });

  it("says which project's clone is not on this machine rather than failing the page", () => {
    const { workspace } = estate();
    rmSync(join(workspace.root, "..", "aviacore"), { recursive: true, force: true });
    const { branches, problems } = listBranches(workspace.root, VENDORED);
    expect(branches).toEqual([]);
    expect(problems).toEqual(["aviacore: no clone at ../aviacore"]);
  });

  it("counts what the branch changed in the project's files, whatever the catalog made of it", () => {
    const { workspace, clone } = estate();
    clone.git("switch", "-q", "-c", "ASUP-976");
    clone.commit("internal/app/b.go", "package app\n");
    clone.commit("docs/ADR/2-void.md", "# void\n");
    const tip = clone.commit("pkg/events/void.go", "package events\n");
    const base = clone.git("rev-parse", "master");

    // The snapshot takes internal/ only, so the ADR is not the project's file.
    const { want } = vendorOf(VENDORED, VENDORED.projects[0]);
    expect(touchedBy(clone.root, base, tip, { want })).toEqual({ files: 1, dirs: ["internal/"] });
    expect(touchedBy(clone.root, base, tip, { want: { ...want, paths: [] } })).toEqual({ files: 3, dirs: ["docs/", "internal/", "pkg/"] });
    expect(listDrafts(workspace.root)).toEqual([]);
  });

  it("says when the clone last fetched, and fetches it when asked", () => {
    const { workspace, clone } = estate();
    const origin = mkdtempSync(join(tmpdir(), "portolan-origin-"));
    created.push(origin);
    execFileSync("git", ["clone", "--quiet", "--bare", clone.root, origin], { encoding: "utf8", env: { ...process.env, ...ADA } });
    clone.git("remote", "add", "origin", origin);

    // Nothing has been fetched yet, so the age is the clone's own HEAD.
    const draft = join(workspace.root, draftPath("aviacore", "ASUP-976"));
    mkdirSync(join(draft, ".."), { recursive: true });
    clone.git("switch", "-q", "-c", "ASUP-976");
    const tip = clone.commit("internal/app/b.go", "package app\n");
    clone.git("switch", "-q", "master");
    writeFileSync(draft, JSON.stringify({ schema: "portolan.draft/v1", project: "aviacore", branch: "ASUP-976", tip, base: "b", generatedAt: "2026-09-17T00:00:00Z", entities: [] }));

    const [saved] = listDrafts(workspace.root);
    expect(saved.clone).toBe("../aviacore");
    expect(saved.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = fetchClone(workspace.root, { project: "aviacore" });
    expect(fetched).toMatchObject({ project: "aviacore", clone: "../aviacore" });
    expect(fetched.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => fetchClone(workspace.root, { project: "docs" })).toThrowError(/not drafted from a clone/);
  });

  it("reads a saved draft's branch from the clone, and refuses to generate without one", async () => {
    const { workspace, clone } = estate();
    clone.git("switch", "-q", "-c", "ASUP-976");
    const tip = clone.commit("internal/app/b.go", "package app\n");
    clone.git("switch", "-q", "master");

    const file = join(workspace.root, draftPath("aviacore", "ASUP-976"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ schema: "portolan.draft/v1", project: "aviacore", branch: "ASUP-976", tip, base: "b", generatedAt: "2026-09-17T00:00:00Z", entities: [] }));
    expect(listDrafts(workspace.root)[0]).toMatchObject({ branch: "ASUP-976", status: "fresh" });

    clone.git("switch", "-q", "ASUP-976");
    const moved = clone.commit("internal/app/c.go", "package app\n");
    expect(listDrafts(workspace.root)[0]).toMatchObject({ status: "moved", currentTip: moved });

    rmSync(clone.root, { recursive: true, force: true });
    expect(listDrafts(workspace.root)[0]).toMatchObject({ status: "failed", failure: { message: "no clone of aviacore at ../aviacore" } });
    await expect(generateDraft(workspace.root, { project: "aviacore", branch: "ASUP-976", pending: true })).rejects.toThrowError(/no clone of it there/);
  });
});
