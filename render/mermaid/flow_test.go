package mermaid

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

func TestSequenceDrawsResponseAsDashedReverseMessage(t *testing.T) {
	flow := &catalog.Flow{
		Participants: []catalog.Participant{
			{ID: "client", Kind: catalog.ParticipantActor},
			{ID: "api", Kind: catalog.ParticipantService},
		},
		Steps: catalog.FlowNodes{
			&catalog.Step{Type: "step", ID: "request", From: "client", To: "api", Kind: catalog.StepRPC, Label: "GET /book", Status: catalog.StatusDeclared},
			&catalog.Step{Type: "step", ID: "response", From: "api", To: "client", Kind: catalog.StepResponse, Label: "HTTP response", Status: catalog.StatusDeclared, ReplyTo: "request"},
		},
	}

	got := Sequence(flow, func(step *catalog.Step) string { return step.Label })
	if !strings.Contains(got, "p0->>p1: GET /book\n    p1-->>p0: HTTP response") {
		t.Fatalf("sequence did not distinguish request and response:\n%s", got)
	}
}

func TestSequenceWrapsHTTPErrorInMutedRed(t *testing.T) {
	flow := &catalog.Flow{
		Participants: []catalog.Participant{{ID: "client"}, {ID: "api"}},
		Steps: catalog.FlowNodes{
			&catalog.Step{Type: "step", ID: "request", From: "client", To: "api", Kind: catalog.StepRPC},
			&catalog.Step{Type: "step", ID: "failure", From: "api", To: "client", Kind: catalog.StepResponse, Label: "500 · Error", ReplyTo: "request", HTTP: &catalog.HTTPResponse{Status: 500, Outcome: "error"}},
		},
	}

	got := Sequence(flow, func(step *catalog.Step) string { return step.Label })
	if !strings.Contains(got, "rect rgba(183, 100, 107, 0.12)\n        p1-->>p0: 500 · Error\n    end") {
		t.Fatalf("HTTP error was not softly highlighted:\n%s", got)
	}
}
