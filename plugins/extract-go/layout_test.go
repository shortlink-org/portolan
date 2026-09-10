package extractgo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func TestLayoutClassifiersAcceptHorizontalAndFeatureSlices(t *testing.T) {
	tests := []struct {
		path      string
		aggregate string
		useCase   string
	}{
		{"github.com/example/auth/internal/domain/user", "user", ""},
		{"github.com/example/auth/internal/user/domain", "user", ""},
		{"github.com/example/auth/internal/application/user/usecases/register", "user", "register"},
		{"github.com/example/auth/internal/user/application/register", "user", "register"},
		{"github.com/example/auth/internal/user/application/usecases/register", "user", "register"},
	}

	for _, tt := range tests {
		if tt.useCase == "" {
			if got, ok := domainImport(tt.path); !ok || got != tt.aggregate {
				t.Errorf("domainImport(%q) = %q, %v", tt.path, got, ok)
			}
			continue
		}
		aggregate, name, ok := useCaseImport(tt.path)
		if !ok || aggregate != tt.aggregate || name != tt.useCase {
			t.Errorf("useCaseImport(%q) = %q, %q, %v", tt.path, aggregate, name, ok)
		}
	}
}

func TestDiscoverLayoutFindsFeaturePackages(t *testing.T) {
	root := t.TempDir()
	write := func(name, contents string) {
		t.Helper()
		filename := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("internal/user/domain/user.go", "package user\ntype User struct{}\n")
	write("internal/user/application/register/usecase.go", "package register\ntype UseCase struct{}\n")
	write("internal/user/application/credentials/port.go", "package credentials\ntype PasswordHasher interface{}\n")
	write("internal/user/integration/event/event.go", "package event\nconst Topic = \"users\"\n")
	write("internal/user/infrastructure/http/handler.go", "package http\ntype Handler struct{}\n")
	write("internal/session/infrastructure/messaging/policy/revoke.go", "package policy\ntype Revoke struct{}\n")
	write("internal/transport/http/gen/server.gen.go", "package gen\ntype ServerInterface interface{}\n")

	layout := discoverLayout(root)
	if got := layout.domains["user"]; got != "internal/user/domain" {
		t.Errorf("user domain = %q", got)
	}
	if got := layout.useCases["user/register"]; got != "internal/user/application/register" {
		t.Errorf("register use case = %q", got)
	}
	if _, found := layout.useCases["user/credentials"]; found {
		t.Error("an application support package was classified as a use case")
	}
	if got := layout.integrationEvents["user"]; got != "internal/user/integration/event" {
		t.Errorf("integration events = %q", got)
	}
	if len(layout.http) != 1 || layout.http[0] != "internal/user/infrastructure/http" {
		t.Errorf("http packages = %v", layout.http)
	}
	if len(layout.policies) != 1 || layout.policies[0] != "internal/session/infrastructure/messaging/policy" {
		t.Errorf("policy packages = %v", layout.policies)
	}
}

func TestExtractsFeatureSlicedAuthExample(t *testing.T) {
	root := filepath.Join("..", "..", "examples", "auth")
	resp, err := extract(plugin.Input{Root: root}, Options{
		Context: "auth", Service: "auth", Store: "pg",
	})
	if err != nil {
		t.Fatal(err)
	}

	var got catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &got); err != nil {
		t.Fatal(err)
	}
	service := got.Contexts[0].Services[0]
	if len(service.Aggregates) != 3 {
		t.Fatalf("aggregates = %d, want user, session and lockout", len(service.Aggregates))
	}

	wantOperations := map[string]int{"user": 4, "session": 4, "lockout": 3}
	for _, aggregate := range service.Aggregates {
		if len(aggregate.Operations) != wantOperations[aggregate.Slug] {
			t.Errorf("%s operations = %d, want %d", aggregate.Slug, len(aggregate.Operations), wantOperations[aggregate.Slug])
		}
		for _, event := range aggregate.Events {
			if event.Wire == nil || event.Wire.Channel == "" {
				t.Errorf("%s.%s has no integration-event channel", aggregate.Slug, event.Name)
			}
		}
	}

	foundPolicy := false
	for _, flow := range got.Flows {
		if flow.ID == "flow.auth-revoke-sessions-on-password-change" {
			foundPolicy = true
		}
	}
	if !foundPolicy {
		t.Error("the feature-local password-change policy was not extracted")
	}
	if !strings.Contains(resp.Files[0].Contents, `"ref": "auth.auth.lockout.AccountLocked"`) {
		t.Error("AccountLocked collected into an event slice was not followed to the repository")
	}
}
