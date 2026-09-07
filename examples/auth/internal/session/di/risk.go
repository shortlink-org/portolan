package di

import (
	"fmt"

	"github.com/google/wire"
	sdkconfig "github.com/shortlink-org/go-sdk/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/risk"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/risk/gen/riskpb"
)

// Risk is the other service login talks to, and the two providers say the two
// separate things about it: where it is, and what login makes of its answer.
var RiskSet = wire.NewSet(
	ProvideRiskClient,
	ProvideRisk,
)

// ProvideRiskClient creates the external client when risk is enabled. With the
// feature disabled it returns a permissive local implementation so the example
// remains self-contained. A configured dependency is fail-closed: RPC errors
// are returned by login and no session is issued.
func ProvideRiskClient(cfg *sdkconfig.Config) (riskpb.RiskServiceClient, error) {
	cfg.SetDefault("RISK_ADDR", "")
	addr := cfg.GetString("RISK_ADDR")

	// Preserve the previous configuration contract: RISK_ADDR by itself still
	// enables the integration. RISK_ENABLED is the explicit feature toggle and
	// can force it off even when an address is present.
	cfg.SetDefault("RISK_ENABLED", addr != "")

	if !cfg.GetBool("RISK_ENABLED") {
		return risk.Permissive{}, nil
	}

	if addr == "" {
		return nil, fmt.Errorf("session di: risk: RISK_ADDR is required when RISK_ENABLED=true")
	}

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("session di: risk: %w", err)
	}
	return riskpb.NewRiskServiceClient(conn), nil
}

// ProvideRisk binds login's port to the adapter over the client. This is the
// line the catalog reads to learn that a login is a call to risk.v1.
func ProvideRisk(rpc riskpb.RiskServiceClient) login.Risk {
	return risk.New(rpc)
}
