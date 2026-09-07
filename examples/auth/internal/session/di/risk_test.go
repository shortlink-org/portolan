package di

import (
	"testing"

	sdkconfig "github.com/shortlink-org/go-sdk/config"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/risk"
)

func newConfig(t *testing.T) *sdkconfig.Config {
	t.Helper()
	t.Setenv("RISK_ENABLED", "")
	t.Setenv("RISK_ADDR", "")
	cfg, err := sdkconfig.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cfg.Close() })
	return cfg
}

func TestRiskIsPermissiveByDefault(t *testing.T) {
	client, err := ProvideRiskClient(newConfig(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := client.(risk.Permissive); !ok {
		t.Fatalf("client = %T, want the local permissive client", client)
	}
}

func TestEnabledRiskRequiresAnAddress(t *testing.T) {
	cfg := newConfig(t)
	cfg.Set("RISK_ENABLED", true)

	if _, err := ProvideRiskClient(cfg); err == nil {
		t.Fatal("enabled risk without RISK_ADDR should fail assembly")
	}
}

func TestAddressAloneKeepsThePreviousEnablementBehaviour(t *testing.T) {
	cfg := newConfig(t)
	cfg.Set("RISK_ADDR", "127.0.0.1:1")

	client, err := ProvideRiskClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := client.(risk.Permissive); ok {
		t.Fatalf("client = %T, want the configured gRPC client", client)
	}
}

func TestFeatureToggleCanDisableAConfiguredRiskService(t *testing.T) {
	cfg := newConfig(t)
	cfg.Set("RISK_ENABLED", false)
	cfg.Set("RISK_ADDR", "127.0.0.1:1")

	client, err := ProvideRiskClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := client.(risk.Permissive); !ok {
		t.Fatalf("client = %T, want the local permissive client", client)
	}
}
