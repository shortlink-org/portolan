import { describe, expect, it, vi } from "vitest";
import { listGitRefs, parseGitRefs } from "./git-refs.mjs";

const line = (ref) => `${"a".repeat(40)}\t${ref}\n`;
describe("remote Git revisions", () => {
  it("groups, sorts and deduplicates full refs without confusing branches with tags", () => {
    expect(parseGitRefs(line("refs/tags/main") + line("refs/heads/main") + line("refs/heads/feature/toolbar") + line("refs/heads/main") + line("refs/tags/main^{}") + line("HEAD") + "invalid")).toEqual({
      refs: [
        { ref: "refs/heads/feature/toolbar", name: "feature/toolbar", kind: "branch" },
        { ref: "refs/heads/main", name: "main", kind: "branch" },
        { ref: "refs/tags/main", name: "main", kind: "tag" },
      ], truncated: false,
    });
  });
  it("handles empty repositories and bounds supported results", () => {
    expect(parseGitRefs("")).toEqual({ refs: [], truncated: false });
    const result = parseGitRefs(Array.from({ length: 2001 }, (_, i) => line(`refs/heads/branch-${i}`)).join(""));
    expect(result.refs).toHaveLength(2000);
    expect(result.truncated).toBe(true);
    expect(parseGitRefs(line("refs/heads/feature@unsupported"))).toEqual({ refs: [], truncated: true });
  });
  it.each(["https://github.com/acme/shop", "git@github.com:acme/shop.git"])("uses a bounded noninteractive read for %s", async (repository) => {
    const run = vi.fn().mockResolvedValue({ stdout: line("refs/heads/main") });
    expect((await listGitRefs(repository, { run, env: { SSH_AUTH_SOCK: "/agent" } })).refs).toHaveLength(1);
    expect(run).toHaveBeenCalledWith("git", ["-c", "credential.interactive=false", "ls-remote", "--refs", "--heads", "--tags", "--", repository], expect.objectContaining({ timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0", SSH_AUTH_SOCK: "/agent", GIT_SSH_COMMAND: expect.stringContaining("StrictHostKeyChecking=yes") }) }));
  });
  it.each(["file:///tmp/repo", "https://secret@github.com/acme/shop", "--upload-pack=evil", "http://github.com/acme/shop"])("rejects unsafe repository %s before invoking git", async (repository) => {
    const run = vi.fn();
    await expect(listGitRefs(repository, { run })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    [{ stderr: "Permission denied token=secret" }, /credential helper/],
    [{ stderr: "Host key verification failed secret" }, /host key/],
    [{ killed: true }, /timed out/],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }, /too many revisions/],
    [{ stderr: "some secret error" }, /Could not load/],
  ])("sanitizes failures and releases the request slot", async (cause, message) => {
    await expect(listGitRefs("github.com/acme/shop", { run: vi.fn().mockRejectedValue(cause) })).rejects.toThrow(message);
    await expect(listGitRefs("github.com/acme/shop", { run: vi.fn().mockResolvedValue({ stdout: "" }) })).resolves.toEqual({ refs: [], truncated: false });
  });
  it("limits concurrent requests", async () => {
    let release;
    const run = () => new Promise((resolve) => { release = resolve; });
    const releases = [];
    const requests = Array.from({ length: 4 }, () => { const request = listGitRefs("github.com/acme/shop", { run }); releases.push(release); return request; });
    try { await expect(listGitRefs("github.com/acme/shop", { run })).rejects.toThrow(/Other revision requests/); }
    finally { releases.forEach((resolve) => resolve({ stdout: "" })); await Promise.all(requests); }
  });
});
