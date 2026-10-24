package extractdeploymentvalues

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestServeExtractsEnvironmentScopedValuesWithoutSecrets(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".helm-ovh", "configmap.prod.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`configmap:
  AVIASUPP_ADDR: http://aviasupp.srv.team
  KAFKA_BOOKING_UPDATE_IN_TOPIC: avia-suppliers-events
  KAFKA_PASSWORD: vault:prod/data/apps/aviacore#KAFKA_PASSWORD
  PARTNER_AUTH: should-never-leave-the-extractor
  UNRELATED_SETTING: ignored
`), 0o644); err != nil {
		t.Fatal(err)
	}

	options, _ := json.Marshal(Options{
		Context:   "avia",
		Service:   "aviacore",
		Paths:     []string{".helm-ovh/configmap.prod.yaml"},
		Variables: []string{"AVIASUPP_ADDR", "KAFKA_BOOKING_UPDATE_IN_TOPIC", "KAFKA_PASSWORD", "PARTNER_AUTH"},
	})
	request, _ := json.Marshal(plugin.Request{
		PortolanVersion: plugin.Version,
		Input:           plugin.Input{Root: root},
		Options:         options,
	})
	var output bytes.Buffer
	if err := Serve(bytes.NewReader(request), &output); err != nil {
		t.Fatal(err)
	}

	var response plugin.Response
	if err := json.Unmarshal(output.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Files) != 1 {
		t.Fatalf("files = %d", len(response.Files))
	}
	var got catalog.Catalog
	if err := json.Unmarshal([]byte(response.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	want := []catalog.ConfigurationBinding{
		{Service: "avia.aviacore", Environment: "prod", Variable: "AVIASUPP_ADDR", Value: "http://aviasupp.srv.team", Source: ".helm-ovh/configmap.prod.yaml:2"},
		{Service: "avia.aviacore", Environment: "prod", Variable: "KAFKA_BOOKING_UPDATE_IN_TOPIC", Value: "avia-suppliers-events", Source: ".helm-ovh/configmap.prod.yaml:3"},
		{Service: "avia.aviacore", Environment: "prod", Variable: "KAFKA_PASSWORD", SecretRef: "vault:prod/data/apps/aviacore#KAFKA_PASSWORD", Source: ".helm-ovh/configmap.prod.yaml:4"},
		{Service: "avia.aviacore", Environment: "prod", Variable: "PARTNER_AUTH", SecretRef: "redacted", Source: ".helm-ovh/configmap.prod.yaml:5"},
	}
	if encoded, expected := mustJSON(t, got.ConfigurationBindings), mustJSON(t, want); encoded != expected {
		t.Fatalf("bindings differ\ngot  %s\nwant %s", encoded, expected)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}
