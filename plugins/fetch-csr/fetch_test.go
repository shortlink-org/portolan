package main

// The fetcher, against a recorded registry. NEVER against a live one: a test
// that reaches a Confluent endpoint would fail on a train, and the whole point
// of this plugin's design is that the build does not depend on a registry
// being up.

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
	valueSubject = "shop.oms.order-value"
	partySubject = "shop.oms.Party"
)

// The value schema references the party one, which is how a registry says a
// record is shared between subjects.
var (
	orderSchema = `{"type":"record","namespace":"shop.oms","name":"OrderPlaced","fields":[{"name":"order_id","type":"string"},{"name":"buyer","type":"shop.oms.Party"}]}`
	partySchema = `{"type":"record","namespace":"shop.oms","name":"Party","fields":[{"name":"id","type":"string"}]}`
)

// registry serves the one call this plugin makes, from recorded shapes.
func registry(t *testing.T, seen *[]string) *httptest.Server {
	t.Helper()

	answers := map[string]registration{
		"/subjects/shop.oms.order-value/versions/3": {
			Subject: valueSubject, Version: 3, ID: 100021, GUID: "8f0d",
			SchemaType: "AVRO", Schema: orderSchema,
			References: []Reference{{Name: "shop.oms.Party", Subject: partySubject, Version: 1}},
		},
		"/subjects/shop.oms.order-value/versions/latest": {
			Subject: valueSubject, Version: 3, ID: 100021, GUID: "8f0d",
			SchemaType: "AVRO", Schema: orderSchema,
			References: []Reference{{Name: "shop.oms.Party", Subject: partySubject, Version: 1}},
		},
		"/subjects/shop.oms.Party/versions/1": {
			Subject: partySubject, Version: 1, ID: 100014,
			SchemaType: "AVRO", Schema: partySchema,
		},
	}

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = append(*seen, r.Header.Get("Authorization"))
		}

		w.Header().Set("Content-Type", "application/json")

		answer, known := answers[r.URL.Path]
		if !known {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error_code":40401,"message":"Subject '` + r.URL.Path + `' not found."}`))

			return
		}

		_ = json.NewEncoder(w).Encode(answer)
	}))
}

func options(server *httptest.Server, cache string, subjects ...Subject) Options {
	return Options{Registry: server.URL, Cache: cache, Subjects: subjects}
}

// names is the file list, sorted, so a test can say what a run produced
// without depending on the order the queue happened to drain in.
func names(resp plugin.Response) []string {
	var out []string
	for _, f := range resp.Files {
		out = append(out, f.Name)
	}
	sort.Strings(out)

	return out
}

func contents(t *testing.T, resp plugin.Response, name string) string {
	t.Helper()

	for _, f := range resp.Files {
		if f.Name == name {
			return f.Contents
		}
	}
	t.Fatalf("no file named %s in %v", name, names(resp))

	return ""
}

// write is the host's half: it puts a response into a tree, so the next run
// can replay from it the way a real one replays from what was committed.
func write(t *testing.T, root string, resp plugin.Response) {
	t.Helper()

	for _, f := range resp.Files {
		at := filepath.Join(root, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(at, []byte(f.Contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func offlineOff(t *testing.T) {
	t.Helper()
	t.Setenv(OfflineEnv, "")
	t.Setenv("CI", "")
}

func TestFetchWritesSchemaAndLock(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)
	defer server.Close()

	cache := t.TempDir()
	resp, err := fetch(options(server, cache, Subject{Subject: valueSubject, Version: 3}))
	if err != nil {
		t.Fatal(err)
	}

	want := []string{
		"shop.oms.Party/csr.lock.json",
		"shop.oms.Party/v1.avsc",
		"shop.oms.order-value/csr.lock.json",
		"shop.oms.order-value/v3.avsc",
	}
	if got := names(resp); !equal(got, want) {
		t.Errorf("files:\n got %v\nwant %v", got, want)
	}

	// The reference was followed without the manifest naming it: the referring
	// schema pinned it, which is the whole argument for following one at all.
	if got := contents(t, resp, "shop.oms.Party/v1.avsc"); !strings.Contains(got, `"name": "Party"`) {
		t.Errorf("the referenced schema is not the one the registry served:\n%s", got)
	}

	// Indented rather than the one line the registry answers with, so a
	// version bump is a diff a person can read.
	schema := contents(t, resp, "shop.oms.order-value/v3.avsc")
	if !strings.Contains(schema, "\n  \"type\": \"record\"") {
		t.Errorf("the schema was not indented:\n%s", schema)
	}
	if !strings.HasSuffix(schema, "\n") {
		t.Error("the schema does not end in a newline")
	}
	// json.Indent reformats without reordering, so the file still says what
	// the registry said in the order it said it.
	if strings.Index(schema, `"namespace"`) > strings.Index(schema, `"name"`) {
		t.Errorf("the schema's keys were reordered:\n%s", schema)
	}

	var lock Lock
	if err := json.Unmarshal([]byte(contents(t, resp, "shop.oms.order-value/csr.lock.json")), &lock); err != nil {
		t.Fatal(err)
	}
	if lock.Registry != server.URL {
		t.Errorf("lock names registry %q, want %q", lock.Registry, server.URL)
	}
	if len(lock.Subjects) != 1 {
		t.Fatalf("lock names %d subjects, want 1", len(lock.Subjects))
	}

	entry := lock.Subjects[0]
	if entry.Subject != valueSubject || entry.Version != 3 || entry.ID != 100021 {
		t.Errorf("lock entry: %+v", entry)
	}
	if entry.SchemaType != "AVRO" {
		t.Errorf("schema type %q, want AVRO", entry.SchemaType)
	}
	if len(entry.References) != 1 || entry.References[0].Subject != partySubject {
		t.Errorf("references: %+v", entry.References)
	}
	if len(entry.Files) != 1 || entry.Files[0].Path != "v3.avsc" {
		t.Fatalf("files: %+v", entry.Files)
	}
	// The digest is over the bytes as written, so verifying needs no
	// reformatting of anything.
	if entry.Files[0].SHA256 != digestOf([]byte(schema)) {
		t.Error("the digest is not over the bytes that were written")
	}
	if entry.Files[0].Size != len(schema) {
		t.Errorf("size %d, want %d", entry.Files[0].Size, len(schema))
	}
}

func TestAbsentSchemaTypeIsAvro(t *testing.T) {
	offlineOff(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// A registry that predates the field says nothing, and that silence
		// means Avro rather than "unknown".
		_, _ = w.Write([]byte(`{"subject":"legacy-value","version":1,"id":7,"schema":` +
			mustQuote(partySchema) + `}`))
	}))
	defer server.Close()

	resp, err := fetch(options(server, t.TempDir(), Subject{Subject: "legacy-value", Version: 1}))
	if err != nil {
		t.Fatal(err)
	}
	if got := names(resp); !equal(got, []string{"legacy-value/csr.lock.json", "legacy-value/v1.avsc"}) {
		t.Errorf("files: %v", got)
	}
}

func TestUnpinnedResolvesLatestAndSaysSo(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)
	defer server.Close()

	resp, err := fetch(options(server, t.TempDir(), Subject{Subject: valueSubject}))
	if err != nil {
		t.Fatal(err)
	}
	if got := contents(t, resp, "shop.oms.order-value/v3.avsc"); got == "" {
		t.Error("latest resolved to nothing")
	}

	warnings := resp.Warnings()
	if len(warnings) != 1 || !strings.Contains(warnings[0].Message, "not pinned") {
		t.Errorf("an unpinned subject was not reported: %+v", warnings)
	}
}

func TestOfflineReplaysWhatWasCommitted(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)

	cache := t.TempDir()
	opts := options(server, cache, Subject{Subject: valueSubject, Version: 3})

	first, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, first)

	// The registry is gone AND the plugin is told not to look, which is CI.
	server.Close()
	t.Setenv(OfflineEnv, "1")

	second, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}

	// Byte-identical, or `gen:check` would go red on a build that changed
	// nothing.
	if !sameFiles(first, second) {
		t.Errorf("the offline run differs:\n online %v\noffline %v", names(first), names(second))
	}
	// The reference was followed from the lock rather than from the registry.
	if got := contents(t, second, "shop.oms.Party/v1.avsc"); got == "" {
		t.Error("the referenced subject was not replayed")
	}
}

func TestOfflineRefusesAnUnpinnedSubject(t *testing.T) {
	t.Setenv(OfflineEnv, "1")
	server := registry(t, nil)
	defer server.Close()

	_, err := fetch(options(server, t.TempDir(), Subject{Subject: valueSubject}))
	if err == nil || !strings.Contains(err.Error(), "not pinned") {
		t.Errorf("an unpinned subject was replayed offline: %v", err)
	}
}

func TestAFailedFetchFallsBackToTheTree(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)

	cache := t.TempDir()
	opts := options(server, cache, Subject{Subject: valueSubject, Version: 3})

	first, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, first)

	// Rule 2: the registry is down, the tree still holds a good copy, so the
	// output is unchanged.
	server.Close()

	second, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	if !sameFiles(first, second) {
		t.Error("a fetch that failed over to the tree produced different files")
	}
	if len(second.Warnings()) == 0 {
		t.Error("falling back to the tree was not reported")
	}
}

func TestAFailedFetchWithNoTreeIsAnError(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)
	server.Close()

	// Rule 3: never a short file list. The host deletes what a step stops
	// naming, and a laptop going offline must not empty the vendored schemas.
	_, err := fetch(options(server, t.TempDir(), Subject{Subject: valueSubject, Version: 3}))
	if err == nil {
		t.Fatal("a fetch with nothing to fall back to succeeded")
	}
	if !strings.Contains(err.Error(), "no usable copy") {
		t.Errorf("the error does not say the tree is empty: %v", err)
	}
}

func TestAnEditedVendoredCopyIsReported(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)

	cache := t.TempDir()
	opts := options(server, cache, Subject{Subject: valueSubject, Version: 3})

	first, err := fetch(opts)
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, first)

	at := filepath.Join(cache, "shop.oms.order-value", "v3.avsc")
	if err := os.WriteFile(at, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	server.Close()
	t.Setenv(OfflineEnv, "1")

	_, err = fetch(opts)
	if err == nil || !strings.Contains(err.Error(), "edited by hand") {
		t.Errorf("an edited vendored copy was accepted: %v", err)
	}
}

func TestAMovedPinIsReportedRatherThanReplayed(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)

	cache := t.TempDir()
	first, err := fetch(options(server, cache, Subject{Subject: valueSubject, Version: 3}))
	if err != nil {
		t.Fatal(err)
	}
	write(t, cache, first)

	server.Close()
	t.Setenv(OfflineEnv, "1")

	_, err = fetch(options(server, cache, Subject{Subject: valueSubject, Version: 4}))
	if err == nil || !strings.Contains(err.Error(), "holds version 3") {
		t.Errorf("a moved pin was replayed from the old version: %v", err)
	}
}

func TestOneSubjectAtTwoVersionsIsRefused(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)
	defer server.Close()

	_, err := fetch(options(server, t.TempDir(),
		Subject{Subject: valueSubject, Version: 3},
		Subject{Subject: valueSubject, Version: 2},
	))
	if err == nil || !strings.Contains(err.Error(), "one version per subject") {
		t.Errorf("two versions of one subject were fetched into one directory: %v", err)
	}
}

func TestAMissingSubjectSaysWhatTheRegistrySaid(t *testing.T) {
	offlineOff(t)
	server := registry(t, nil)
	defer server.Close()

	_, err := fetch(options(server, t.TempDir(), Subject{Subject: "nope-value", Version: 1}))
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("the registry's own message was lost: %v", err)
	}
}

func TestTheCredentialComesFromTheEnvironment(t *testing.T) {
	offlineOff(t)

	var seen []string
	server := registry(t, &seen)
	defer server.Close()

	t.Setenv(TokenEnv, "")
	t.Setenv(ShortKeyEnv, "KEY")
	t.Setenv(ShortSecretEnv, "SECRET")
	t.Setenv(KeyEnv, "")
	t.Setenv(SecretEnv, "")

	if _, err := fetch(options(server, t.TempDir(), Subject{Subject: valueSubject, Version: 3})); err != nil {
		t.Fatal(err)
	}

	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("KEY:SECRET"))
	for _, got := range seen {
		if got != want {
			t.Fatalf("Authorization %q, want %q", got, want)
		}
	}
	if len(seen) == 0 {
		t.Fatal("the registry was never called")
	}
}

func TestABareTokenIsGivenAScheme(t *testing.T) {
	t.Setenv(TokenEnv, "abc123")
	if got := authorization(); got != "Bearer abc123" {
		t.Errorf("authorization %q", got)
	}

	// One that already names its scheme is passed through: guessing on the
	// caller's behalf is how a working token starts failing.
	t.Setenv(TokenEnv, "Negotiate abc123")
	if got := authorization(); got != "Negotiate abc123" {
		t.Errorf("authorization %q", got)
	}
}

func TestSlugOfKeepsTheSubjectReadable(t *testing.T) {
	for subject, want := range map[string]string{
		"shop.oms.order-value": "shop.oms.order-value",
		"shop.oms.OrderPlaced": "shop.oms.OrderPlaced",
		"a/b:c value":          "a_b_c_value",
		"...":                  "_",
	} {
		if got := slugOf(subject); got != want {
			t.Errorf("slugOf(%q) = %q, want %q", subject, got, want)
		}
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

func sameFiles(a, b plugin.Response) bool {
	if len(a.Files) != len(b.Files) {
		return false
	}

	held := map[string]string{}
	for _, f := range a.Files {
		held[f.Name] = f.Contents
	}
	for _, f := range b.Files {
		if held[f.Name] != f.Contents {
			return false
		}
	}

	return true
}

func mustQuote(s string) string {
	out, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}

	return string(out)
}
