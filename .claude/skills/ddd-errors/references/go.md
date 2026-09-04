# Errors in Go

Sentinels, `domain/user/user.go`:

```go
var (
    ErrInvalidCredentials = errors.New("user: invalid credentials")
    ErrNotFound           = errors.New("user: not found")
    ErrEmailTaken         = errors.New("user: email already registered")
    ErrConflict           = errors.New("user: changed by somebody else")
)
```

Marker wrapping rules, `vo/password/password.go`:

```go
var ErrInvalid = errors.New("password is not acceptable")
return Hash{}, fmt.Errorf("%w: %w", ErrInvalid, err) // two %w: marker and joined rules both match errors.Is
```

Use case's own error, `usecases/login/port.go`:

```go
var ErrBlocked = errors.New("login: attempt blocked")
```

Adapter translation and wrapping, `repository/user/postgres.go`:

```go
var pgErr *pgconn.PgError
if errors.As(err, &pgErr) && pgErr.Code == "23505" {
    if pgErr.ConstraintName == "users_email_key" {
        return user.ErrEmailTaken
    }
    return user.ErrConflict
}
if err != nil {
    return fmt.Errorf("user: inserting %s: %w", u.ID, err)
}
if tag.RowsAffected() == 0 {
    return user.ErrConflict
}
```

External client, `risk/client.go`:

```go
if err != nil { return "", fmt.Errorf("risk: assess: %w", err) }
default:      return "", fmt.Errorf("risk: assess: verdict %d is not one this service knows", v)
```

Transport mapping, `transport/http/user/errors.go`: `status(err) (int, string)`
with `errors.Is` arms and a `default: 500, "internal error"`; `reasons(err)`
walks `Unwrap() []error` and `Unwrap() error` to list the leaves.

Conventions:

- `errors.Is` / `errors.As` everywhere; never compare `Error()` strings.
- Wrap with `%w`, prefix with the package name and the operation and id.
- Sentinels are `var`, not functions returning new errors, so identity holds.
