# Transport in Go

From `examples/auth/internal/infrastructure/transport/http`.

```
transport/http/
  gen/openapi.yaml      the contract
  gen/cfg.yaml, gen/generate.go, gen/server.gen.go   oapi-codegen strict server
  server.go             mounts the generated handler, middleware for everything
  telemetry.go
  <aggregate>/
    handler.go          struct holding the use cases it serves
    <endpoint>.go       one file per endpoint
    errors.go           status(err) and reasons(err)
```

`errors.go`:

```go
func status(err error) (code int, message string) {
    switch {
    case errors.Is(err, email.ErrInvalid), errors.Is(err, password.ErrInvalid):
        return 400, "the request is not acceptable"
    case errors.Is(err, user.ErrEmailTaken):
        return 409, "that address is already registered"
    case errors.Is(err, user.ErrConflict):
        return 409, "the user was changed by somebody else; read it again and retry"
    case errors.Is(err, user.ErrInvalidCredentials):
        return 401, "invalid credentials"
    case errors.Is(err, user.ErrNotFound):
        return 404, "no such user"
    default:
        return 500, "internal error"
    }
}

// reasons walks Unwrap() []error (errors.Join) and Unwrap() error, skipping
// the marker and collecting leaf rule messages.
func reasons(err error) []string
```

A handler:

```go
func (h *Users) ChangePassword(ctx context.Context, request gen.ChangePasswordRequestObject) (gen.ChangePasswordResponseObject, error) {
    current, err := h.validate.Handle(ctx, validatedto.Input{Token: bearer(request.Params.Authorization)})
    if err != nil {
        return gen.ChangePassword401JSONResponse{Message: "unauthorized"}, nil
    }
    err = h.changePassword.Handle(ctx, changedto.Input{
        UserID: current.UserID, By: current.SessionID,
        Current: request.Body.CurrentPassword, New: request.Body.NewPassword,
    })
    if err != nil {
        return changePasswordFailure(err), nil
    }
    return gen.ChangePassword204Response{}, nil
}
```

The strict-server style returns typed responses and a nil error; the error
return is reserved for the framework. `bearer()` yields "" for anything that
is not a bearer header, and "" is treated as an unknown token.
