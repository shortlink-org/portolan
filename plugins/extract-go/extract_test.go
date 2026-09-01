package main

import (
	"io"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// The extractor's own golden is examples/auth/portolan/domain.json, which is
// committed and checked by `npm run gen:check`. What is worth testing here is
// the handful of judgements it makes on the way: what a name becomes, what
// counts as a command, and which prose is worth keeping.

func TestSlug(t *testing.T) {
	cases := map[string]string{
		"User":          "user",
		"PriceList":     "price-list",
		"OrderLine":     "order-line",
		"email.Address": "email-address",
		"ID":            "id",
		"HTTPServer":    "http-server",
	}

	for in, want := range cases {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCamelAndTitle(t *testing.T) {
	if got := camel("end_after_credential_change"); got != "EndAfterCredentialChange" {
		t.Errorf("camel = %q", got)
	}
	if got := title("price_list"); got != "Price List" {
		t.Errorf("title = %q", got)
	}
}

// token.Token adds nothing over Token; password.Hash says which Hash.
func TestQualified(t *testing.T) {
	if got := qualified("token", "Token"); got != "Token" {
		t.Errorf("qualified = %q", got)
	}
	if got := qualified("password", "Hash"); got != "password.Hash" {
		t.Errorf("qualified = %q", got)
	}
}

func TestWithoutPackagePrefix(t *testing.T) {
	got := withoutPackagePrefix("user", "Package user holds the User aggregate: a person.")
	if got != "Holds the User aggregate: a person." {
		t.Errorf("withoutPackagePrefix = %q", got)
	}

	// A comment that does not follow the convention is left exactly as written.
	unchanged := "The User aggregate."
	if got := withoutPackagePrefix("user", unchanged); got != unchanged {
		t.Errorf("withoutPackagePrefix rewrote %q", got)
	}
}

func TestFirstParagraphAfterTitle(t *testing.T) {
	md := "# register\n\nCreates a user from an email address and a password.\n\n## What it does\n\n1. Normalises.\n"
	if got := firstParagraphAfterTitle(md); got != "Creates a user from an email address and a password." {
		t.Errorf("firstParagraphAfterTitle = %q", got)
	}
}

// The classification a reader most depends on: a use case that writes is a
// command even when the write happens in a helper rather than in Handle.
func TestOperationKindFollowsHelpers(t *testing.T) {
	pkg := mustParse(t, `package usecase

type UseCase struct{}

func (uc *UseCase) Handle(ctx any, in any) error {
	for _, id := range uc.list() {
		if err := uc.end(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func (uc *UseCase) end(ctx any, id string) error { return uc.repo.Save(ctx, id) }
`)

	if got := operationKind(pkg); got != catalog.OperationCommand {
		t.Errorf("a use case that saves in a helper is a command, got %q", got)
	}
}

func TestOperationKindReadOnlyIsQuery(t *testing.T) {
	pkg := mustParse(t, `package usecase

type UseCase struct{}

func (uc *UseCase) Handle(ctx any, in any) (any, error) { return uc.repo.ByID(ctx, "id") }
`)

	if got := operationKind(pkg); got != catalog.OperationQuery {
		t.Errorf("a use case that only reads is a query, got %q", got)
	}
}

// An extractor with nothing to read must say so rather than answer with an
// empty service that looks like a service with no model.
func TestExtractRefusesAnEmptyRoot(t *testing.T) {
	request := `{"portolanVersion":"0.1.0","input":{"root":""}}`
	if err := run(strings.NewReader(request), io.Discard); err == nil {
		t.Error("a request with no input root should be refused")
	}
}

func TestEventsNeedAName(t *testing.T) {
	pkg := mustParse(t, `package event

// Envelope wraps a published event. It is not one.
type Envelope struct{ payload string }

// UserRegistered is published once per user.
type UserRegistered struct{ userID string }

func (UserRegistered) Name() string { return "auth.UserRegistered" }
`)

	events := eventsIn(pkg, "auth.auth.user")
	if len(events) != 1 || events[0].Name != "UserRegistered" {
		t.Fatalf("expected only UserRegistered, got %v", names(events))
	}
	if got := events[0].Versions[0].Doc; !strings.Contains(got, "auth.UserRegistered") {
		t.Errorf("the bus topic should survive into the version doc, got %q", got)
	}
}

func names(events []catalog.Event) []string {
	out := make([]string, len(events))
	for i := range events {
		out[i] = events[i].Name
	}

	return out
}

func mustParse(t *testing.T, src string) *pkg {
	t.Helper()

	parsed, err := parseSource("source.go", src)
	if err != nil {
		t.Fatal(err)
	}

	return parsed
}
