// Describing a plugin: what it is called, where it belongs in a run, and what
// it can be told.
//
// The options a plugin takes are facts the source does not carry - which
// bounded context a Go module belongs to, whose proto package a client calls.
// Only the plugin knows them, and until it could say so the manifest was a
// file you wrote by reading somebody's struct. A misspelled key was silently
// dropped, because that is what encoding/json does with a field it does not
// recognise.
//
// So a plugin answers a second question now. The schema it hands back is
// composed into schema/portolan.schema.json, which an editor reads while the
// manifest is being written and the host checks before it runs anything.

package plugin

import (
	"encoding/json"
	"fmt"
	"io"
)

// KindDescribe asks a plugin what it is rather than asking it to work.
const KindDescribe = "describe"

// Phases a step can be declared under in the manifest. A plugin names the ones
// it belongs in, which is what stops the schema from offering an extractor
// where a renderer goes.
const (
	PhaseExtract  = "extract"
	PhaseVerify   = "verify"
	PhaseGenerate = "generate"
)

// Descriptor is a plugin's answer to KindDescribe.
type Descriptor struct {
	// Name is what the plugin calls itself. The manifest is free to declare it
	// under another name - the schema is keyed by the declared one - so this is
	// for the reader, not for lookup.
	Name string `json:"name"`

	// Summary is one line, and it is the line an editor shows beside the step.
	Summary string `json:"summary,omitempty"`

	// Phases are the manifest sections this plugin belongs in.
	Phases []string `json:"phases"`

	// Options is a JSON Schema for what the manifest may pass in `options`.
	// It must close itself with `additionalProperties: false`: the misspelled
	// key is the error worth catching, and a schema that accepts anything
	// catches nothing.
	Options json.RawMessage `json:"options,omitempty"`
}

// Serve reads one request and writes one response - the whole of a plugin's
// main, apart from the work itself.
//
// Every plugin had this loop written out, and each copy had to remember the
// describe branch once there was one. The options type is the only thing that
// differs, so it is the only thing the caller supplies.
func Serve[O any](stdin io.Reader, stdout io.Writer, d Descriptor, run func(Request, O) (Response, error)) error {
	in, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("reading the request: %w", err)
	}

	var req Request
	if err := json.Unmarshal(in, &req); err != nil {
		return fmt.Errorf("the request is not a portolan plugin request: %w", err)
	}

	resp := Response{}
	switch req.Kind {
	case KindDescribe:
		// Files is named rather than left nil because the host reads it on
		// every response, and a describe that answers `"files": null` is a
		// plugin that looks broken the first time anyone asks it anything.
		resp = Response{Files: []File{}, Describe: &d}
	case "":
		var opts O
		if len(req.Options) > 0 {
			if err := json.Unmarshal(req.Options, &opts); err != nil {
				return fmt.Errorf("options: %w", err)
			}
		}

		if resp, err = run(req, opts); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown request kind %q", req.Kind)
	}

	out, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("encoding the response: %w", err)
	}

	if _, err := stdout.Write(out); err != nil {
		return fmt.Errorf("writing the response: %w", err)
	}

	return nil
}
