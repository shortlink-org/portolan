// Package webauthn adapts the webauthn service, which holds the public keys of
// every registered passkey, to login_passkey's Verifier.
package webauthn

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/shortlink-org/portolan/examples/auth/internal/session/application/login_passkey"
)

// Client verifies assertions over the service's HTTP API.
type Client struct {
	base string
	http *http.Client
}

func New(base string, httpClient *http.Client) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: httpClient}
}

type verifyRequest struct {
	CredentialID string `json:"credentialId"`
	Challenge    string `json:"challenge"`
	Signature    string `json:"signature"`
}

type verifyResponse struct {
	UserID string `json:"userId"`
}

// Verify posts the assertion to POST /v1/assertions/verify. A 401 or 404 is a
// rejection; anything else that is not a 200 is the service failing, which
// login treats as a refusal to issue rather than as a verdict.
func (c *Client) Verify(ctx context.Context, assertion login_passkey.Assertion) (string, error) {
	body, err := json.Marshal(verifyRequest(assertion))
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/v1/assertions/verify", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("webauthn: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusOK:
		var out verifyResponse
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return "", fmt.Errorf("webauthn: %w", err)
		}
		if out.UserID == "" {
			return "", login_passkey.ErrRejected
		}
		return out.UserID, nil
	case http.StatusUnauthorized, http.StatusNotFound:
		return "", login_passkey.ErrRejected
	default:
		return "", fmt.Errorf("webauthn: unexpected status %d", resp.StatusCode)
	}
}

// ErrUnavailable is returned by Disabled: passkeys are not configured here.
var ErrUnavailable = errors.New("webauthn: passkeys are not configured")

// Disabled refuses every assertion, so the example runs without the service.
type Disabled struct{}

func (Disabled) Verify(context.Context, login_passkey.Assertion) (string, error) {
	return "", ErrUnavailable
}
