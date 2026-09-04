package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

// A repository to fetch from, made on the spot: git itself is the fake, and
// what it serves is what a forge would serve.
type remote struct {
	url    string
	commit string
}

func repository(t *testing.T) remote {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git on PATH")
	}
	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{
			"-c", "user.name=test", "-c", "user.email=test@example.com",
			"-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main",
		}, args...)...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}

		return strings.TrimSpace(string(out))
	}
	write := func(rel, contents string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	run("init", "--quiet")
	write("services/oms/internal/domain/order/order.go", "package order\n")
	write("services/oms/README.md", "# OMS\n")
	write("proto/shop/v1/orders.proto", "syntax = \"proto3\";\n")
	write("README.md", "# shop\n")
	run("add", ".")
	run("commit", "--quiet", "-m", "the estate")
	// A forge lets a client fetch a commit by name; a plain file remote does
	// not unless told to, and the fallback to branches is tested separately.
	run("config", "uploadpack.allowAnySHA1InWant", "true")

	return remote{url: "file://" + dir, commit: run("rev-parse", "HEAD")}
}

func options(r remote, cache string, paths ...string) Options {
	return Options{
		Cache: cache,
		Repos: []Repo{{Repo: r.url, Commit: r.commit, Paths: paths}},
	}
}

// Every test decides for itself whether it is online.
func isolate(t *testing.T) {
	t.Helper()
	t.Setenv(OfflineEnv, "")
	t.Setenv("CI", "")
}

func names(resp plugin.Response) []string {
	out := make([]string, 0, len(resp.Files))
	for _, f := range resp.Files {
		out = append(out, f.Name)
	}
	sort.Strings(out)

	return out
}

func contentsOf(resp plugin.Response, name string) string {
	for _, f := range resp.Files {
		if f.Name == name {
			return f.Contents
		}
	}

	return ""
}

// write does what the host does with a response.
func write(t *testing.T, dir string, resp plugin.Response) {
	t.Helper()
	for _, f := range resp.Files {
		at := filepath.Join(dir, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(at, []byte(f.Contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFetchWritesTheNarrowedCopyAndALock(t *testing.T) {
	isolate(t)
	r := repository(t)

	resp, err := fetch(options(r, t.TempDir(), "services/oms", "proto"))
	if err != nil {
		t.Fatal(err)
	}
	// The directory is owner/name, read off the URL; the paths inside are
	// the repository's own, so an extractor can read the copy as a checkout.
	dir := filepath.Base(filepath.Dir(strings.TrimPrefix(r.url, "file://"))) + "/" + filepath.Base(strings.TrimPrefix(r.url, "file://"))
	want := []string{
		dir + "/git.lock.json",
		dir + "/proto/shop/v1/orders.proto",
		dir + "/services/oms/README.md",
		dir + "/services/oms/internal/domain/order/order.go",
	}
	if got := names(resp); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("files = %v, want %v", got, want)
	}
	lock := contentsOf(resp, dir+"/git.lock.json")
	if !strings.Contains(lock, `"commit": "`+r.commit+`"`) || !strings.Contains(lock, `"sha256"`) || !strings.Contains(lock, `"services/oms"`) {
		t.Errorf("lock = %s", lock)
	}
	if len(resp.Diagnostics) != 0 {
		t.Errorf("diagnostics = %+v", resp.Diagnostics)
	}
}

func TestOfflineReplayIsByteIdentical(t *testing.T) {
	isolate(t)
	r := repository(t)
	cache := t.TempDir()

	online, err := fetch(options(r, cache, "services/oms"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	t.Setenv(OfflineEnv, "1")
	replayed, err := fetch(options(r, cache, "services/oms"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names(online), "\n") != strings.Join(names(replayed), "\n") {
		t.Fatalf("offline names = %v, online %v", names(replayed), names(online))
	}
	for _, f := range online.Files {
		if contentsOf(replayed, f.Name) != f.Contents {
			t.Errorf("%s differs offline", f.Name)
		}
	}
	if len(replayed.Diagnostics) != 1 || !strings.Contains(replayed.Diagnostics[0].Message, "offline") {
		t.Errorf("diagnostics = %+v, want the one saying the copy was used", replayed.Diagnostics)
	}
}

func TestCiImpliesOffline(t *testing.T) {
	isolate(t)
	r := repository(t)
	cache := t.TempDir()
	online, err := fetch(options(r, cache, "proto"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	t.Setenv("CI", "true")
	replayed, err := fetch(options(r, cache, "proto"))
	if err != nil {
		t.Fatal(err)
	}
	if len(replayed.Diagnostics) != 1 {
		t.Errorf("CI should replay and say so: %+v", replayed.Diagnostics)
	}
}

func TestEditedCacheIsReportedByPath(t *testing.T) {
	isolate(t)
	r := repository(t)
	cache := t.TempDir()
	online, err := fetch(options(r, cache, "services/oms"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	var edited string
	for _, name := range names(online) {
		if strings.HasSuffix(name, "order.go") {
			edited = name
		}
	}
	if err := os.WriteFile(filepath.Join(cache, filepath.FromSlash(edited)), []byte("package order // edited\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv(OfflineEnv, "1")
	_, err = fetch(options(r, cache, "services/oms"))
	if err == nil || !strings.Contains(err.Error(), "order.go") || !strings.Contains(err.Error(), "edited by hand") {
		t.Fatalf("err = %v, want the edited file named", err)
	}
}

func TestOfflineWithNoCacheFailsRatherThanEmittingNothing(t *testing.T) {
	isolate(t)
	t.Setenv(OfflineEnv, "1")
	resp, err := fetch(options(remote{url: "file:///nowhere/acme/shop", commit: "0000000000000000000000000000000000000000"}, t.TempDir()))
	if err == nil || len(resp.Files) != 0 {
		t.Fatalf("err = %v, files = %v", err, names(resp))
	}
}

func TestFailedFetchWithNoCacheFails(t *testing.T) {
	isolate(t)
	_, err := fetch(options(remote{url: "file://" + filepath.Join(t.TempDir(), "acme", "gone"), commit: "0000000000000000000000000000000000000000"}, t.TempDir()))
	if err == nil || !strings.Contains(err.Error(), "no usable copy") {
		t.Fatalf("err = %v", err)
	}
}

func TestFailedFetchFallsBackToTheCommittedCopy(t *testing.T) {
	isolate(t)
	r := repository(t)
	cache := t.TempDir()
	online, err := fetch(options(r, cache, "proto"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	// The forge is gone; the URL is the same, so the copy is in the same place.
	if err := os.RemoveAll(strings.TrimPrefix(r.url, "file://")); err != nil {
		t.Fatal(err)
	}
	fallback, err := fetch(options(r, cache, "proto"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(names(fallback), "\n") != strings.Join(names(online), "\n") {
		t.Errorf("fallback = %v", names(fallback))
	}
	if len(fallback.Diagnostics) != 1 || !strings.Contains(fallback.Diagnostics[0].Message, "not fetched") {
		t.Errorf("diagnostics = %+v", fallback.Diagnostics)
	}
}

func TestUnpinnedRepositoryIsResolvedOnlineAndRefusedOffline(t *testing.T) {
	isolate(t)
	r := repository(t)
	opts := Options{Cache: t.TempDir(), Repos: []Repo{{Repo: r.url, Ref: "main", Paths: []string{"proto"}}}}

	resp, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Diagnostics) != 1 || !strings.Contains(resp.Diagnostics[0].Message, "not pinned") || !strings.Contains(resp.Diagnostics[0].Message, r.commit) {
		t.Errorf("diagnostics = %+v", resp.Diagnostics)
	}

	t.Setenv(OfflineEnv, "1")
	if _, err := fetch(opts); err == nil || !strings.Contains(err.Error(), "not pinned") {
		t.Fatalf("err = %v", err)
	}
}

// A remote that does not serve commits by name still serves its branches,
// and the commit is found among them.
func TestACommitIsFetchedThroughItsBranchWhenTheRemoteRefusesIt(t *testing.T) {
	isolate(t)
	r := repository(t)
	cmd := exec.Command("git", "config", "--unset", "uploadpack.allowAnySHA1InWant")
	cmd.Dir = strings.TrimPrefix(r.url, "file://")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}

	resp, err := fetch(options(r, t.TempDir(), "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if got := names(resp); len(got) != 2 {
		t.Errorf("files = %v", got)
	}
}

func TestSplitRepo(t *testing.T) {
	cases := map[string]string{
		"github.com/acme/shop":              "https://github.com/acme/shop|acme/shop",
		"https://gitlab.com/acme/shop.git":  "https://gitlab.com/acme/shop.git|acme/shop",
		"git@github.com:acme/shop.git":      "git@github.com:acme/shop.git|acme/shop",
		"ssh://git@github.com/acme/shop":    "ssh://git@github.com/acme/shop|acme/shop",
		"https://gitlab.com/org/group/shop": "https://gitlab.com/org/group/shop|group/shop",
	}
	for name, want := range cases {
		url, dir, err := splitRepo(name)
		if err != nil || url+"|"+dir != want {
			t.Errorf("%s = %s|%s %v, want %s", name, url, dir, err, want)
		}
	}
	if _, _, err := splitRepo("shop"); err == nil {
		t.Error("a bare name has no owner and should be refused")
	}
}
