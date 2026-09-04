# Specification in Go

The helper is `github.com/shortlink-org/go-sdk/specification`:

```go
type Specification[T any] interface {
    IsSatisfiedBy(value *T) error
}

func NewAndSpecification[T any](specs ...Specification[T]) Specification[T] // joins every failure
func NewOrSpecification[T any](specs ...Specification[T]) Specification[T]
func NewNotSpecification[T any](spec Specification[T]) Specification[T]
```

A rule, `examples/auth/internal/domain/user/vo/email/rules/no_display_name.go` style:

```go
package rules

var ErrDisplayName = errors.New("email must be a bare address, not a display form")

type NoDisplayNameSpec struct{}

var _ specification.Specification[string] = NoDisplayNameSpec{}

func (NoDisplayNameSpec) IsSatisfiedBy(value *string) error {
    if value == nil {
        return ErrDisplayName
    }
    if addr, err := mail.ParseAddress(*value); err == nil && addr.Name != "" {
        return ErrDisplayName
    }
    return nil
}
```

The composite, `rules/composite.go`:

```go
func NewSpecification() specification.Specification[string] {
    return specification.NewAndSpecification[string](
        RequiredSpec{},
        MaxLengthSpec{},
        ParsableSpec{},
        NoDisplayNameSpec{},
    )
}
```

Use in the value object:

```go
var ErrInvalid = errors.New("email is not acceptable")
var policy = rules.NewSpecification()

func New(raw string) (Address, error) {
    if err := policy.IsSatisfiedBy(&raw); err != nil {
        return Address{}, fmt.Errorf("%w: %w", ErrInvalid, err)
    }
    ...
}
```

Walking the failures (the transport does this in `reasons(err)`):

```go
var walk func(error)
walk = func(e error) {
    switch x := e.(type) {
    case interface{ Unwrap() []error }:   // errors.Join / And
        for _, inner := range x.Unwrap() { walk(inner) }
    case interface{ Unwrap() error }:     // the marker wrapping
        if inner := x.Unwrap(); inner != nil { walk(inner) }
    default:
        if !errors.Is(e, email.ErrInvalid) { out = append(out, e.Error()) }
    }
}
```

Tests: `rules/rules_test.go` runs a table over each rule alone, then one
case through `NewSpecification()` that breaks several rules and asserts
`errors.Is` for each of them on the joined error.
