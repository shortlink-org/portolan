# Use case in Go

From `examples/auth/internal/application/session/usecases/login`.

```
application/<aggregate>/usecases/<use_case>/
  usecase.go      UseCase, New, Handle
  port.go         ports declared by this use case (Authenticator, Risk), closed sets, its own errors
  dto/input.go
  dto/output.go   omitted when the answer is "no content"
  usecase_test.go
  README.md
```

```go
package login

type Authenticator interface {
    Authenticate(ctx context.Context, email, password string) (userID string, err error)
}

type Risk interface {
    Assess(ctx context.Context, attempt Attempt) (Verdict, error)
}

type Verdict string
const (
    VerdictAllow Verdict = "allow"
    VerdictBlock Verdict = "block"
)

var ErrBlocked = errors.New("login: attempt blocked")

type UseCase struct {
    repo  session.Repository
    auth  Authenticator
    risk  Risk
    now   func() time.Time
    newID func() string
}

func New(repo session.Repository, auth Authenticator, risk Risk, now func() time.Time, newID func() string) *UseCase

func (uc *UseCase) Handle(ctx context.Context, in dto.Input) (dto.Output, error) {
    userID, err := uc.auth.Authenticate(ctx, in.Email, in.Password)
    if err != nil {
        return dto.Output{}, err // pass through untouched
    }
    verdict, err := uc.risk.Assess(ctx, Attempt{UserID: userID})
    if err != nil {
        return dto.Output{}, err // unreachable is not a verdict
    }
    if verdict == VerdictBlock { ... return dto.Output{}, ErrBlocked }

    sess, ev, err := session.Start(uc.newID(), userID, uc.now())
    ...
    if err := uc.repo.Save(ctx, sess, ev); err != nil { return dto.Output{}, err }
    return dto.Output{Token: sess.Token.String(), ExpiresAt: sess.ExpiresAt}, nil
}
```

Conventions:

- `Handle(ctx, dto.Input) (dto.Output, error)`; when there is nothing to
  return, `Handle(ctx, dto.Input) error`.
- Package name is the verb in snake_case; import it as-is (`login`,
  `change_password`).
- A use case that needs two aggregates in one transaction wraps both saves
  in the unit of work; the repositories' own transactions join it. See
  [ddd-adapters](../../ddd-adapters/references/go.md).
