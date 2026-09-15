package di

import (
	"net/http"
	"time"

	"github.com/google/wire"
	sdkconfig "github.com/shortlink-org/go-sdk/config"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login_passkey"
	"github.com/shortlink-org/portolan/examples/auth/internal/session/infrastructure/webauthn"
)

// WebAuthnSet binds the passkey login's verifier to the webauthn service.
var WebAuthnSet = wire.NewSet(ProvideVerifier)

// ProvideVerifier talks to the service at WEBAUTHN_ADDR. Without an address
// passkeys are off and every assertion is refused, so the example stays
// self-contained.
func ProvideVerifier(cfg *sdkconfig.Config) login_passkey.Verifier {
	cfg.SetDefault("WEBAUTHN_ADDR", "")
	addr := cfg.GetString("WEBAUTHN_ADDR")
	if addr == "" {
		return webauthn.Disabled{}
	}
	return webauthn.New(addr, &http.Client{Timeout: 5 * time.Second})
}
