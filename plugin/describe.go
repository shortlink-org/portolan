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

// Categories a plugin sorts itself under on the plugin index: what it reads,
// or what it makes. A phase says where in a run a plugin goes; a category
// says what kind of fact it is after, which is the question a reader choosing
// extractors for an estate is asking.
const (
	// CategoryCode reads a language: the aggregates, events and use cases a
	// service declares in its source.
	CategoryCode = "code"
	// CategoryContracts reads an interface description - OpenAPI, protobuf,
	// GraphQL, WSDL, AsyncAPI, a registry's schemas.
	CategoryContracts = "contracts"
	// CategoryMessaging reads queues, subjects, topics and the jobs on them.
	CategoryMessaging = "messaging"
	// CategoryData reads the stores a service keeps and their shape.
	CategoryData = "data"
	// CategoryRepository reads what the repository says about itself: its
	// metadata, its task runners.
	CategoryRepository = "repository"
	// CategoryDocuments reads what people wrote by hand: decisions, glossaries,
	// flows.
	CategoryDocuments = "documents"
	// CategoryEvidence checks the catalog against something outside the code:
	// traces, ownership rules.
	CategoryEvidence = "evidence"
	// CategorySources brings in trees from elsewhere for the extractors to read.
	CategorySources = "sources"
	// CategoryExports turns the catalog into something else.
	CategoryExports = "exports"
)

// Descriptor is a plugin's answer to KindDescribe.
type Descriptor struct {
	// Name is what the plugin calls itself. The manifest is free to declare it
	// under another name - the schema is keyed by the declared one - so this is
	// for the reader, not for lookup.
	Name string `json:"name"`

	// Summary is one line, and it is the line an editor shows beside the step.
	Summary string `json:"summary,omitempty"`

	// Category is one of the Category constants: what the plugin reads or
	// makes, which is how the plugin index groups it.
	Category string `json:"category"`

	// Phases are the manifest sections this plugin belongs in.
	Phases []string `json:"phases"`

	// Options is a JSON Schema for what the manifest may pass in `options`.
	// It must close itself with `additionalProperties: false`: the misspelled
	// key is the error worth catching, and a schema that accepts anything
	// catches nothing.
	Options json.RawMessage `json:"options,omitempty"`

	// Needs names what the host must put in the request beyond the tree: a
	// fact a sandboxed module cannot reach on its own. The one need so far is
	// NeedHistory (portolan.0007). A host that cannot supply a need leaves
	// the field out, and the plugin says what it could not do without it.
	Needs []string `json:"needs,omitempty"`
}

// NeedHistory asks the host for Input.History: when each file under the root
// was first committed and last changed, read from git by the host so that the
// plugin need not run anything.
const NeedHistory = "history"

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
	if req.PortolanVersion != "" && req.PortolanVersion != Version {
		return fmt.Errorf("unsupported portolan protocol %q (plugin supports %s)", req.PortolanVersion, Version)
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
