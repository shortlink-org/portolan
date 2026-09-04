# Testing in Go

From `examples/auth/internal/application/session/usecases/login/usecase_test.go`,
`domain/session/services/credential_change_test.go`, `pkg/postgrestest`.

A port satisfied inline:

```go
type authFunc func(ctx context.Context, email, password string) (string, error)

func (f authFunc) Authenticate(ctx context.Context, email, password string) (string, error) {
    return f(ctx, email, password)
}

func vouches(userID string) login.Authenticator {
    return authFunc(func(context.Context, string, string) (string, error) { return userID, nil })
}

func refuses() login.Authenticator {
    return authFunc(func(context.Context, string, string) (string, error) {
        return "", user.ErrInvalidCredentials
    })
}
```

The harness:

```go
var now = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

type harness struct {
    uc     *login.UseCase
    store  *repo.Postgres
    events []event.Event
}

func newHarnessWith(t *testing.T, auth login.Authenticator, risk login.Risk) *harness {
    t.Helper()
    h := &harness{}
    b := bus.NewInProc()
    b.Subscribe("", func(_ context.Context, e event.Event) error {
        h.events = append(h.events, e)
        return nil
    })
    router, unit := postgrestest.Store(t, postgrestest.Source{FS: repo.Migrations, Name: repo.Name})
    h.store = repo.NewPostgres(router, unit, b)
    h.uc = login.New(h.store, auth, risk, func() time.Time { return now }, func() string { return "s1" })
    return h
}

func TestMain(m *testing.M) {
    code := m.Run()
    postgrestest.Stop()
    os.Exit(code)
}
```

A test named for its rule:

```go
// The rule this use case exists to enforce: no session for a user the user
// domain did not vouch for.
func TestNoSessionWithoutTheAuthenticator(t *testing.T) {
    h := newHarness(t, refuses())
    out, err := h.uc.Handle(ctx, dto.Input{Email: "ada@example.com", Password: "wrong"})
    if !errors.Is(err, user.ErrInvalidCredentials) {
        t.Fatalf("= %v, want the authenticator's error untouched", err)
    }
    if out.Token != "" { t.Error("a refused login handed out a token") }
    if len(h.events) != 0 { t.Errorf("%d events, want a refused login to announce nothing", len(h.events)) }
}
```

`pkg/postgrestest` starts one testcontainers Postgres per package, gives a
database per test, applies the adapter's migrations from its embedded FS,
and builds the store with the same `WithTxLookup(sdkuow.FromContext)` that
assembly uses. It skips when Docker is absent. `pkg/redistest` does the same
for the cache.

Standard library `testing` only; no assertion or mocking libraries.
