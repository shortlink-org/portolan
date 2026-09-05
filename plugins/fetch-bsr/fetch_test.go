package main

// The fetcher, against a recorded registry. NEVER against a live one: a test
// that reaches buf.build would fail on a train, and the whole point of this
// plugin's design is that the build does not depend on a registry being up.

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

const (
	moduleName = "buf.build/acme/shop"
	pinned     = "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6"
)

var protoFile = "syntax = \"proto3\";\n\npackage shop.v1;\n\nservice Orders {\n  rpc PlaceOrder(PlaceOrderRequest) returns (PlaceOrderResponse);\n}\n\nmessage PlaceOrderRequest { string customer_id = 1; }\nmessage PlaceOrderResponse { string order_id = 1; }\n"

// registry serves the two calls this plugin makes, from recorded shapes.
func registry(t *testing.T, seen *[]string) *httptest.Server {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = append(*seen, r.Header.Get("Authorization"))
		}

		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case downloadMethod:
			var req downloadRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Errorf("the download request is not json: %v", err)
			}
			// The wire shape, asserted here rather than assumed: a request that
			// stopped naming the module would still "pass" every other test.
			if len(req.Values) != 1 || req.Values[0].ResourceRef.Name == nil {
				t.Errorf("download request: %+v", req)
			} else {
				name := req.Values[0].ResourceRef.Name
				if name.Owner != "acme" || name.Module != "shop" {
					t.Errorf("download names %s/%s", name.Owner, name.Module)
				}
			}

			_, _ = w.Write([]byte(`{"contents":[{"commit":{"id":"` + pinned +
				`","digest":{"type":"DIGEST_TYPE_B5","value":"` +
				base64.StdEncoding.EncodeToString([]byte{0xde, 0xad, 0xbe, 0xef}) +
				`"}},"files":[{"path":"shop/v1/orders.proto","content":"` +
				base64.StdEncoding.EncodeToString([]byte(protoFile)) + `"}]}]}`))

		case commitsMethod:
			_, _ = w.Write([]byte(`{"commits":[{"id":"` + pinned +
				`","digest":{"type":"DIGEST_TYPE_B5","value":"` +
				base64.StdEncoding.EncodeToString([]byte{0xde, 0xad, 0xbe, 0xef}) + `"}}]}`))

		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":"not_found","message":"no such method"}`))
		}
	}))
	t.Cleanup(server.Close)

	return server
}

func options(t *testing.T, base, cache string) Options {
	t.Helper()

	return Options{
		Registry: base,
		Cache:    cache,
		Modules:  []Module{{Module: moduleName, Commit: pinned}},
	}
}

// A test must never inherit a real credential or a real offline setting from
// whoever is running it.
func isolate(t *testing.T) {
	t.Helper()
	t.Setenv(TokenEnv, "")
	t.Setenv(OfflineEnv, "")
	t.Setenv("CI", "")
	t.Setenv("HOME", t.TempDir())
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

// write puts a response into a directory the way the host's apply() would, so
// the next run can replay it.
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

func TestFetchWritesProtosAndALock(t *testing.T) {
	isolate(t)
	server := registry(t, nil)
	cache := t.TempDir()

	resp, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}

	// Each module in its own directory with its own lock, so extract-proto
	// finds the lock beside the files it is already reading.
	want := []string{"acme/shop/bsr.lock.json", "acme/shop/shop/v1/orders.proto"}
	if got := names(resp); !equal(got, want) {
		t.Fatalf("files: %v, want %v", got, want)
	}
	if contentsOf(resp, "acme/shop/shop/v1/orders.proto") != protoFile {
		t.Error("the proto came back changed")
	}

	var lock Lock
	if err := json.Unmarshal([]byte(contentsOf(resp, "acme/shop/bsr.lock.json")), &lock); err != nil {
		t.Fatal(err)
	}
	if len(lock.Modules) != 1 || lock.Modules[0].Commit != pinned {
		t.Fatalf("lock: %+v", lock)
	}
	if lock.Modules[0].Digest != "b5:deadbeef" {
		t.Errorf("digest: %q, want the b5:hex form buf writes", lock.Modules[0].Digest)
	}
	if len(lock.Modules[0].Files) != 1 || lock.Modules[0].Files[0].SHA256 != digestOf([]byte(protoFile)) {
		t.Errorf("the lock does not record what was written: %+v", lock.Modules[0].Files)
	}
}

// THE CI-GREEN GUARANTEE, TESTED.
//
// An offline run over a committed copy must produce output byte-identical to
// the online run that wrote it, or `gen:check` reports drift on every build
// that cannot reach the registry - which is every build in CI.
func TestOfflineReplayIsByteIdentical(t *testing.T) {
	isolate(t)
	server := registry(t, nil)
	cache := t.TempDir()

	online, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	t.Setenv(OfflineEnv, "1")
	replayed, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}

	if !equal(names(online), names(replayed)) {
		t.Fatalf("offline emitted %v, online emitted %v", names(replayed), names(online))
	}
	for _, f := range online.Files {
		if contentsOf(replayed, f.Name) != f.Contents {
			t.Errorf("%s differs between an online and an offline run", f.Name)
		}
	}
	if len(replayed.Warnings()) != 1 || !strings.Contains(replayed.Warnings()[0].Message, "not fetched") {
		t.Errorf("an offline run said nothing about not fetching: %+v", replayed.Warnings())
	}
}

// CI is set on every runner, so a build there never opens a socket even if
// nobody remembered to set PORTOLAN_OFFLINE.
func TestCiImpliesOffline(t *testing.T) {
	isolate(t)
	cache := t.TempDir()
	server := registry(t, nil)

	online, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	t.Setenv("CI", "true")
	if _, err := fetch(options(t, server.URL, cache)); err != nil {
		t.Fatalf("a CI run over a committed copy failed: %v", err)
	}
}

// A vendored copy someone edited by hand stops matching its digest. That is
// exactly the drift docs/adr/org.0001.md wants visible, so it is reported by
// path rather than quietly overwritten.
func TestEditedCacheIsReportedByPath(t *testing.T) {
	isolate(t)
	server := registry(t, nil)
	cache := t.TempDir()

	online, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	at := filepath.Join(cache, "acme", "shop", "shop", "v1", "orders.proto")
	if err := os.WriteFile(at, []byte("// edited by hand\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv(OfflineEnv, "1")
	_, err = fetch(options(t, server.URL, cache))
	if err == nil {
		t.Fatal("an edited vendored copy was accepted")
	}
	if !strings.Contains(err.Error(), "shop/v1/orders.proto") {
		t.Errorf("the error does not name the edited file: %v", err)
	}
}

// RULE 3. The host deletes files a step stops naming, so a failed fetch with
// nothing to fall back to must be a non-zero exit and NOT a short file list -
// dropping a repository's vendored protos because a laptop went offline is
// worse than a red build.
func TestOfflineWithNoCacheFailsRatherThanEmittingNothing(t *testing.T) {
	isolate(t)
	t.Setenv(OfflineEnv, "1")

	resp, err := fetch(options(t, "http://127.0.0.1:1", t.TempDir()))
	if err == nil {
		t.Fatalf("an empty cache produced a response instead of an error: %v", names(resp))
	}
	if len(resp.Files) != 0 {
		t.Errorf("a failed run emitted files: %v", names(resp))
	}
}

// The same rule when the registry is reachable but broken.
func TestFailedFetchWithNoCacheFails(t *testing.T) {
	isolate(t)
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":"internal","message":"the registry is having a day"}`))
	}))
	t.Cleanup(broken.Close)

	_, err := fetch(options(t, broken.URL, t.TempDir()))
	if err == nil {
		t.Fatal("a failing registry with no cache produced a response")
	}
	if !strings.Contains(err.Error(), "the registry is having a day") {
		t.Errorf("the registry's own message did not survive: %v", err)
	}
}

// A failing registry with a good copy in the tree is not a failure at all:
// the output is unchanged and the build stays green.
func TestFailedFetchFallsBackToTheCommittedCopy(t *testing.T) {
	isolate(t)
	cache := t.TempDir()

	server := registry(t, nil)
	online, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(broken.Close)

	fallback, err := fetch(options(t, broken.URL, cache))
	if err != nil {
		t.Fatalf("a good committed copy did not save the run: %v", err)
	}
	if !equal(names(fallback), names(online)) {
		t.Errorf("the fallback emitted %v", names(fallback))
	}
}

// Offline there is nothing to resolve a label against, so an unpinned module
// is refused by name rather than guessed at.
func TestUnpinnedModuleIsRefusedOffline(t *testing.T) {
	isolate(t)
	t.Setenv(OfflineEnv, "1")

	opts := options(t, "http://127.0.0.1:1", t.TempDir())
	opts.Modules[0].Commit = ""

	_, err := fetch(opts)
	if err == nil {
		t.Fatal("an unpinned module was accepted offline")
	}
	if !strings.Contains(err.Error(), moduleName) {
		t.Errorf("the error does not name the module: %v", err)
	}
}

// Online it still works, but it is said out loud: two runs a day apart would
// otherwise produce two different trees from one manifest.
func TestUnpinnedModuleWarnsOnline(t *testing.T) {
	isolate(t)
	server := registry(t, nil)

	opts := options(t, server.URL, t.TempDir())
	opts.Modules[0].Commit = ""

	resp, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Warnings()) == 0 || !strings.Contains(resp.Warnings()[0].Message, "not pinned") {
		t.Errorf("an unpinned module was resolved silently: %+v", resp.Warnings())
	}
}

// A pin the tree does not hold is a fetch waiting to happen, not a copy to
// serve. Serving the old one would make `gen:check` pass on the wrong bytes.
func TestCacheAtTheWrongCommitIsRefused(t *testing.T) {
	isolate(t)
	cache := t.TempDir()

	server := registry(t, nil)
	online, err := fetch(options(t, server.URL, cache))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, online)

	t.Setenv(OfflineEnv, "1")
	opts := options(t, server.URL, cache)
	opts.Modules[0].Commit = "0000000000000000000000000000000f"

	if _, err := fetch(opts); err == nil {
		t.Fatal("a copy at another commit was served for a different pin")
	}
}

// A credential changes whether the fetch succeeds, never what it says. If a
// token could reach the output, a public copy and a private one would differ.
func TestOutputIsIdenticalWithAndWithoutAToken(t *testing.T) {
	isolate(t)

	var seen []string
	server := registry(t, &seen)

	anonymous, err := fetch(options(t, server.URL, t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv(TokenEnv, "a-real-looking-secret")
	authorised, err := fetch(options(t, server.URL, t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}

	for _, f := range anonymous.Files {
		if contentsOf(authorised, f.Name) != f.Contents {
			t.Errorf("%s differs depending on whether a token was set", f.Name)
		}
		if strings.Contains(contentsOf(authorised, f.Name), "a-real-looking-secret") {
			t.Fatalf("the token reached %s", f.Name)
		}
	}

	if len(seen) < 2 || seen[0] != "" {
		t.Errorf("the anonymous request sent an Authorization header: %q", seen[0])
	}
	if seen[len(seen)-1] != "Bearer a-real-looking-secret" {
		t.Errorf("the token was not sent: %q", seen[len(seen)-1])
	}
}

// The environment is where a credential comes from, and portolan.json - which
// is committed - is where it must never be.
func TestTokenPrecedence(t *testing.T) {
	isolate(t)

	home := t.TempDir()
	t.Setenv("HOME", home)
	netrc := "machine buf.build login someone password from-netrc\n"
	if err := os.WriteFile(filepath.Join(home, ".netrc"), []byte(netrc), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := token("buf.build"); got != "from-netrc" {
		t.Errorf("with no env var, the netrc password should be used: %q", got)
	}
	if got := token("other.example"); got != "" {
		t.Errorf("a netrc entry for another host was used: %q", got)
	}

	t.Setenv(TokenEnv, "from-env")
	if got := token("buf.build"); got != "from-env" {
		t.Errorf("the environment should win over the netrc: %q", got)
	}
}

// A cache directory is not optional: without one an offline run has nowhere to
// replay from, and the failure would surface as a mysteriously empty step.
func TestCacheIsRequired(t *testing.T) {
	isolate(t)

	opts := options(t, "http://127.0.0.1:1", "")
	if _, err := fetch(opts); err == nil || !strings.Contains(err.Error(), "cache") {
		t.Errorf("a missing cache was not refused clearly: %v", err)
	}
}

func TestModuleNameMustHaveThreeParts(t *testing.T) {
	isolate(t)

	opts := options(t, "http://127.0.0.1:1", t.TempDir())
	opts.Modules[0].Module = "acme/shop"

	if _, err := fetch(opts); err == nil || !strings.Contains(err.Error(), "module name") {
		t.Errorf("a two-part module name was not refused: %v", err)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}
