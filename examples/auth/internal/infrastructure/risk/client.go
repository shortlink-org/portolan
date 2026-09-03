// Package risk adapts the risk service's generated client to the port login
// declares. This is the one package in the tree that knows both exist: login
// states an attempt and a verdict, the client speaks AssessRequest and a
// Verdict enum, and the translation between them lives here rather than in
// either.
package risk

import (
	"context"
	"fmt"

	"google.golang.org/grpc"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/risk/gen/riskpb"
)

// Client is login.Risk over the generated gRPC client.
type Client struct {
	rpc riskpb.RiskServiceClient
}

func New(rpc riskpb.RiskServiceClient) *Client {
	return &Client{rpc: rpc}
}

// Assess asks risk.v1.RiskService/Assess and reads the verdict back into
// login's closed set. An enum value this does not know is an error rather
// than an allow: the contract changed, and guessing which way is how a new
// BLOCK variant becomes a login.
func (c *Client) Assess(ctx context.Context, attempt login.Attempt) (login.Verdict, error) {
	out, err := c.rpc.Assess(ctx, &riskpb.AssessRequest{UserId: attempt.UserID})
	if err != nil {
		return "", fmt.Errorf("risk: assess: %w", err)
	}

	switch out.GetVerdict() {
	case riskpb.Verdict_VERDICT_ALLOW:
		return login.VerdictAllow, nil
	case riskpb.Verdict_VERDICT_BLOCK:
		return login.VerdictBlock, nil
	default:
		return "", fmt.Errorf("risk: assess: verdict %d is not one this service knows", out.GetVerdict())
	}
}

// Permissive is the client the service runs with when no risk service is
// configured: every attempt is allowed. It is a client, not an adapter, so
// that the one adapter above is the only code that reads a verdict.
type Permissive struct{}

func (Permissive) Assess(context.Context, *riskpb.AssessRequest, ...grpc.CallOption) (*riskpb.AssessResponse, error) {
	return &riskpb.AssessResponse{Verdict: riskpb.Verdict_VERDICT_ALLOW}, nil
}
