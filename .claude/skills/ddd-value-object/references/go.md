# Value object in Go

From `examples/auth/internal/domain/user/vo/password` and `vo/email`.

```
vo/password/
  password.go          Hash type, New (applies policy), ParseHash (does not), Matches, String
  rules/
    composite.go       NewSpecification() = And(MinLength, MaxLength, HasDigit, ...)
    min_length.go      MinLengthSpec + ErrTooShort
    has_digit.go       ...
    rules_test.go
```

The specification helper is `github.com/shortlink-org/go-sdk/specification`:

```go
package rules

const MinLength = 8
var ErrTooShort = errors.New("password must be at least 8 characters")

type MinLengthSpec struct{}
var _ specification.Specification[string] = MinLengthSpec{}

func (MinLengthSpec) IsSatisfiedBy(value *string) error {
    if value == nil || len(*value) < MinLength {
        return ErrTooShort
    }
    return nil
}

// composite.go
func NewSpecification() specification.Specification[string] {
    return specification.NewAndSpecification[string](
        MinLengthSpec{}, MaxLengthSpec{}, HasDigitSpec{}, HasLowerSpec{}, HasUpperSpec{}, NoWhitespaceSpec{},
    )
}
```

The value object:

```go
package password

var ErrInvalid = errors.New("password is not acceptable")
var policy = rules.NewSpecification()

type Hash struct { algorithm string; iterations int; salt, digest []byte }

func New(plaintext string) (Hash, error) {
    if err := policy.IsSatisfiedBy(&plaintext); err != nil {
        return Hash{}, fmt.Errorf("%w: %w", ErrInvalid, err) // marker wraps the joined rule errors
    }
    ...
}

func ParseHash(stored string) (Hash, error)   // no policy: reading a fact
func (h Hash) Matches(plaintext string) bool   // no policy; subtle.ConstantTimeCompare
func (h Hash) String() string                  // "alg$iter$salt$digest", for the repository
```

Callers test `errors.Is(err, password.ErrInvalid)`. The transport walks
`Unwrap() []error` to list the leaf rule errors as reasons; see
[ddd-transport](../../ddd-transport/references/go.md).
