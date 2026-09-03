package provider

import (
	"fmt"

	"github.com/google/wire"
	sdkconfig "github.com/shortlink-org/go-sdk/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/shortlink-org/portolan/examples/auth/internal/application/session/usecases/login"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/risk"
	"github.com/shortlink-org/portolan/examples/auth/internal/infrastructure/risk/gen/riskpb"
)

// Risk is the other service login talks to, and the two providers say the two
// separate things about it: where it is, and what login makes of its answer.
var Risk = wire.NewSet(
	ProvideRiskClient,
	ProvideRisk,
)

// ProvideRiskClient opens the connection, or hands back a client that allows
// everything when RISK_ADDR is unset - the service runs without a risk
// service the way it runs without redis, and a laptop should not need one.
// An address that is set and wrong fails here, at assembly, rather than on
// the first login.
func ProvideRiskClient(cfg *sdkconfig.Config) (riskpb.RiskServiceClient, error) {
	cfg.SetDefault("RISK_ADDR", "")

	addr := cfg.GetString("RISK_ADDR")
	if addr == "" {
		return risk.Permissive{}, nil
	}

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("provider: risk: %w", err)
	}
	return riskpb.NewRiskServiceClient(conn), nil
}

// ProvideRisk binds login's port to the adapter over the client. This is the
// line the catalog reads to learn that a login is a call to risk.v1.
func ProvideRisk(rpc riskpb.RiskServiceClient) login.Risk {
	return risk.New(rpc)
}
