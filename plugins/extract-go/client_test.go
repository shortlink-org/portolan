package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

const generatedClient = `package riskpb

import "google.golang.org/grpc"

const (
	RiskService_Assess_FullMethodName = "/risk.v1.RiskService/Assess"
	RiskService_Report_FullMethodName = "/risk.v1.RiskService/Report"
	unrelated                         = "/not/a/method/name"
)

type RiskServiceClient interface {
	Assess(ctx context.Context, in *AssessRequest, opts ...grpc.CallOption) (*AssessResponse, error)
	Report(ctx context.Context, in *ReportRequest, opts ...grpc.CallOption) (*ReportResponse, error)
}
`

// The rpc is read off the constant protoc-gen-go-grpc writes for it, which is
// the one place in the tree the full name appears as a string.
func TestClientsAreReadOffTheGeneratedNames(t *testing.T) {
	pkg, err := parseSource("risk_grpc.pb.go", generatedClient)
	if err != nil {
		t.Fatal(err)
	}

	clients, problem := readClients(pkg)
	if problem != "" {
		t.Fatal(problem)
	}
	client, ok := clients["RiskServiceClient"]
	if !ok {
		t.Fatalf("clients = %v", clients)
	}
	if client.pkg != "risk.v1" {
		t.Errorf("pkg = %q", client.pkg)
	}
	if client.methods["Assess"] != "risk.v1.RiskService/Assess" || client.methods["Report"] != "risk.v1.RiskService/Report" {
		t.Errorf("methods = %v", client.methods)
	}
	if len(client.methods) != 2 {
		t.Errorf("methods = %v, want the two rpcs and not the unrelated constant", client.methods)
	}
	if client.source != "risk_grpc.pb.go" {
		t.Errorf("source = %q", client.source)
	}
}

// The peer is the manifest's to name. With a line for the package the step
// lands on a service; without one the far end is a package name, which the
// catalog does not have, and the step says so.
func TestThePeerIsTheManifestsToName(t *testing.T) {
	client := client{pkg: "risk.v1", methods: map[string]string{"Assess": "risk.v1.RiskService/Assess"}, source: "gen/risk_grpc.pb.go"}

	named := newFlowReader(t.TempDir(), flowOptions{svcID: "auth.auth", peers: map[string]string{"risk.v1": "shop.risk"}}, &plugin.Builder{})
	d := newDraft()
	named.rpcHop(d, rpcHop{client: client, method: "Assess"}, "usecase.go:12")

	step := d.steps[0].(*catalog.Step)
	if step.To != "shop.risk" || step.Kind != catalog.StepRPC || step.Ref != "risk.v1.RiskService/Assess" || step.Status != catalog.StatusDeclared {
		t.Errorf("step = %+v", step)
	}
	if lane := d.lanes[0]; lane.Kind != catalog.ParticipantService || lane.Context == nil || *lane.Context != "shop" {
		t.Errorf("lane = %+v", lane)
	}
	calls := named.consumes()
	if len(calls) != 1 || calls[0].Peer != "shop.risk" || calls[0].Source != "gen/risk_grpc.pb.go" || calls[0].Status != catalog.StatusDeclared {
		t.Errorf("consumes = %+v", calls)
	}

	b := &plugin.Builder{}
	unnamed := newFlowReader(t.TempDir(), flowOptions{svcID: "auth.auth"}, b)
	d = newDraft()
	unnamed.rpcHop(d, rpcHop{client: client, method: "Assess"}, "")
	unnamed.rpcHop(d, rpcHop{client: client, method: "Assess"}, "")

	step = d.steps[0].(*catalog.Step)
	if step.To != "risk-v1" || step.Status != catalog.StatusUnresolved {
		t.Errorf("step = %+v", step)
	}
	if lane := d.lanes[0]; lane.Kind != catalog.ParticipantUnknown || lane.ID != "risk-v1" || lane.Label != "risk.v1" {
		t.Errorf("lane = %+v, want a bare id with the package on the label", lane)
	}
	if calls := unnamed.consumes(); len(calls) != 1 || calls[0].Status != catalog.StatusUnresolved || calls[0].Peer != "risk.v1" {
		t.Errorf("consumes = %+v", calls)
	}
	if n := len(b.Response().Warnings()); n != 1 {
		t.Errorf("diagnostics = %d, want the one warning about the unnamed peer, said once", n)
	}
}

// A policy on somebody else's event is still a policy. Its trigger has an id
// this tree cannot form, so the step names the type and resolves to nothing.
func TestAPolicyOnAForeignEventIsKeptAndUnresolved(t *testing.T) {
	const policy = `package policy

import (
	shopevents "github.com/acme/shop/events/v1"
	"github.com/example/auth/internal/domain/user/event"
	"github.com/example/auth/internal/pkg/helper"
)

type OnOrderPlaced struct{}

func (p OnOrderPlaced) Handle(ctx context.Context, e any) error {
	placed, ok := e.(shopevents.OrderPlaced)
	_ = placed
	return nil
}

type OnPasswordChanged struct{}

func (p OnPasswordChanged) Handle(ctx context.Context, e any) error {
	_, ok := e.(event.PasswordChanged)
	return nil
}

type OnNothing struct{}

func (p OnNothing) Handle(ctx context.Context, e any) error {
	_, ok := e.(helper.Thing)
	return nil
}
`
	pkg, err := parseSource("policy.go", policy)
	if err != nil {
		t.Fatal(err)
	}
	r := &flowReader{opts: flowOptions{svcID: "auth.auth"}, module: "github.com/example/auth"}
	imports := importsOf(pkg)

	foreign, ok := r.assertedEvent(pkg.methods("OnOrderPlaced")["Handle"], imports)
	if !ok || foreign.foreign != "github.com/acme/shop/events/v1" || foreign.name != "OrderPlaced" || foreign.id != "" {
		t.Errorf("foreign = %+v %v", foreign, ok)
	}

	own, ok := r.assertedEvent(pkg.methods("OnPasswordChanged")["Handle"], imports)
	if !ok || own.foreign != "" || own.id != "auth.auth.user.PasswordChanged" {
		t.Errorf("own = %+v %v", own, ok)
	}

	if ref, ok := r.assertedEvent(pkg.methods("OnNothing")["Handle"], imports); ok {
		t.Errorf("a helper type of this module was read as an event: %+v", ref)
	}
}

// The whole chain, on a tree: a use case holds a port of its own, assembly
// fills it with an adapter over a generated client, and the adapter's method
// is what says which rpc the port's method amounts to.
func TestAPortBoundToAClientIsARpcHop(t *testing.T) {
	root := t.TempDir()
	write := func(rel, contents string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, rel), []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("go.mod", "module github.com/example/auth\n\ngo 1.27\n")
	write("internal/infrastructure/risk/gen/riskpb/risk_grpc.pb.go", generatedClient)
	write("internal/infrastructure/risk/client.go", `package risk

import (
	"context"

	"github.com/example/auth/internal/infrastructure/risk/gen/riskpb"
)

type Client struct {
	rpc riskpb.RiskServiceClient
}

func New(rpc riskpb.RiskServiceClient) *Client { return &Client{rpc: rpc} }

func (c *Client) Verdict(ctx context.Context, userID string) (bool, error) {
	out, err := c.rpc.Assess(ctx, &riskpb.AssessRequest{UserId: userID})
	if err != nil {
		return false, err
	}
	return out.Block, nil
}
`)
	write("internal/di/provider/risk.go", `package provider

import (
	"github.com/example/auth/internal/application/session/usecases/login"
	"github.com/example/auth/internal/infrastructure/risk"
	"github.com/example/auth/internal/infrastructure/risk/gen/riskpb"
)

func ProvideRisk(rpc riskpb.RiskServiceClient) login.Risk {
	return risk.New(rpc)
}
`)
	write("internal/application/session/usecases/login/usecase.go", `package login

import (
	"context"

	"github.com/example/auth/internal/domain/session"
)

type Risk interface {
	Verdict(ctx context.Context, userID string) (bool, error)
}

type UseCase struct {
	repo session.Repository
	risk Risk
}

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) error {
	block, err := uc.risk.Verdict(ctx, in.UserID)
	if err != nil {
		return err
	}
	if block {
		if err := uc.repo.Save(ctx, nil); err != nil {
			return err
		}
		return ErrBlocked
	}
	return uc.repo.Save(ctx, nil)
}
`)

	b := &plugin.Builder{}
	r := newFlowReader(root, flowOptions{context: "auth", svcID: "auth.auth", service: "auth", store: "pg", peers: map[string]string{"risk.v1": "shop.risk"}}, b)
	d := newDraft()
	d.lane(r.serviceLane())
	r.walkUseCase(d, "session/login", 0)

	if got := dump(d.steps); got != "s1:Assess alt3{s2:Save } s4:Save " {
		t.Fatalf("nodes = %q", got)
	}
	rpc := d.steps[0].(*catalog.Step)
	if rpc.Kind != catalog.StepRPC || rpc.To != "shop.risk" || rpc.Ref != "risk.v1.RiskService/Assess" || rpc.Status != catalog.StatusDeclared {
		t.Errorf("rpc step = %+v", rpc)
	}
	if rpc.Line != "internal/application/session/usecases/login/usecase.go:19" && filepath.Base(rpc.Line) == "" {
		t.Errorf("line = %q", rpc.Line)
	}
	alt := d.steps[1].(*catalog.Alt)
	if alt.Branches[0].Title != "block" || !alt.Branches[0].Terminal {
		t.Errorf("arm = %+v", alt.Branches[0])
	}
	calls := r.consumes()
	if len(calls) != 1 || calls[0].ID != "risk.v1.RiskService/Assess" || calls[0].Peer != "shop.risk" {
		t.Errorf("consumes = %+v", calls)
	}
	if diags := b.Response().Warnings(); len(diags) != 0 {
		t.Errorf("diagnostics = %+v", diags)
	}
}
