package provider

import (
	"fmt"

	"github.com/google/wire"

	sdkconfig "github.com/shortlink-org/go-sdk/config"
)

// Settings reads the environment through the SDK's config, so this service
// takes the same variable names as everything else built on it:
//
//	STORE_TYPE=postgres
//	STORE_POSTGRES_URI=postgres://auth:auth@localhost:5432/auth?sslmode=disable
var Settings = wire.NewSet(ProvideConfig)

func ProvideConfig() (*sdkconfig.Config, error) {
	cfg, err := sdkconfig.New()
	if err != nil {
		return nil, fmt.Errorf("provider: config: %w", err)
	}
	return cfg, nil
}
