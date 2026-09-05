package plugin_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/plugin"
)

type options struct {
	Context string `json:"context"`
}

func descriptor() plugin.Descriptor {
	return plugin.Descriptor{
		Name:    "example",
		Phases:  []string{plugin.PhaseExtract},
		Options: json.RawMessage(`{"type":"object","additionalProperties":false}`),
	}
}

func TestServeDescribesWithoutWorking(t *testing.T) {
	worked := false
	out := &bytes.Buffer{}

	err := plugin.Serve(strings.NewReader(`{"kind":"describe"}`), out, descriptor(),
		func(plugin.Request, options) (plugin.Response, error) {
			worked = true

			return plugin.Response{}, nil
		})
	if err != nil {
		t.Fatalf("describe: %v", err)
	}

	if worked {
		t.Error("a describe ran the plugin, which is the one thing it must not do")
	}

	var resp plugin.Response
	if err := json.Unmarshal(out.Bytes(), &resp); err != nil {
		t.Fatalf("the answer is not a response: %v", err)
	}

	if resp.Describe == nil {
		t.Fatal("a describe answered without a descriptor")
	}
	if resp.Describe.Name != "example" {
		t.Errorf("descriptor names %q", resp.Describe.Name)
	}

	// The host reads files on every response, so a describe that answers null
	// is a plugin that looks broken the first time anyone asks it anything.
	if !strings.Contains(out.String(), `"files":[]`) {
		t.Errorf("a describe answered %s, which has no files list", out)
	}
}

func TestServeReadsOptions(t *testing.T) {
	var seen options
	out := &bytes.Buffer{}

	err := plugin.Serve(
		strings.NewReader(`{"input":{"root":"examples/auth"},"options":{"context":"auth"}}`),
		out, descriptor(),
		func(req plugin.Request, opts options) (plugin.Response, error) {
			seen = opts

			return plugin.Response{Files: []plugin.File{{Name: req.Input.Root + ".json"}}}, nil
		})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if seen.Context != "auth" {
		t.Errorf("options came through as %+v", seen)
	}
	if !strings.Contains(out.String(), "examples/auth.json") {
		t.Errorf("the response is %s", out)
	}
}

func TestServeRefusesAnUnknownKind(t *testing.T) {
	err := plugin.Serve(strings.NewReader(`{"kind":"explain"}`), &bytes.Buffer{}, descriptor(),
		func(plugin.Request, options) (plugin.Response, error) {
			return plugin.Response{}, nil
		})

	if err == nil || !strings.Contains(err.Error(), "explain") {
		t.Errorf("an unknown kind gave %v", err)
	}
}

func TestServeRefusesAnIncompatibleProtocol(t *testing.T) {
	err := plugin.Serve(strings.NewReader(`{"portolanVersion":"9.0.0","kind":"describe"}`), &bytes.Buffer{}, descriptor(),
		func(plugin.Request, options) (plugin.Response, error) { return plugin.Response{}, nil })
	if err == nil || !strings.Contains(err.Error(), "unsupported portolan protocol") {
		t.Errorf("incompatible version gave %v", err)
	}
}

func TestWarningsAreNotAResponseProperty(t *testing.T) {
	b := &plugin.Builder{}
	b.Warn("fixture", "not represented")
	out, err := json.Marshal(b.Response())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "diagnostics") || strings.Contains(string(out), "warning") {
		t.Errorf("warning leaked into wire response: %s", out)
	}
}
