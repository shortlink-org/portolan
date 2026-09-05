# Assembly in Go (wire)

From `examples/auth/internal/di`.

```
di/
  app.go            App{Handler, Driver, Relay, Cache}; Run; Close
  wire.go           wire.Build(provider.Config, provider.Clock, ...)
  wire_gen.go       generated
  provider/
    clock.go        func() time.Time, func() string
    config.go
    storage.go      postgres store with WithTxLookup(sdkuow.FromContext); uow.New
    cache.go
    bus.go          in-proc buses the relay hands events to; policy subscriptions
    outbox.go       outbox publishers bound to Publisher ports; relay reading every topic into its bus
    repository.go   postgres repos, cache decorator, bound to Repository ports
    risk.go         gRPC client or Permissive; risk.New bound to login.Risk
    authenticator.go  user authenticate use case adapted to login.Authenticator
    usecase.go      every use case constructor
    transport.go    handlers, generated server, middleware
```

The cross-domain adapter, `provider/authenticator.go`:

```go
func ProvideAuthenticator(uc *authenticate.UseCase) login.Authenticator {
    return authenticator{uc: uc}
}

type authenticator struct{ uc *authenticate.UseCase }

func (a authenticator) Authenticate(ctx context.Context, email, password string) (string, error) {
    out, err := a.uc.Handle(ctx, dto.Input{Email: email, Password: password})
    if err != nil {
        return "", err // untouched
    }
    return out.UserID, nil
}
```

Binding a port, `provider/outbox.go`:

```go
var Outbox = wire.NewSet(
    ProvideOutboxPublisher,          // sdkoutbox.NewPublisher(sdkuow.FromContext)
    userrepo.NewPublisher,
    wire.Bind(new(userdomain.Publisher), new(*userrepo.Publisher)),
    sessionrepo.NewPublisher,
    wire.Bind(new(sessiondomain.Publisher), new(*sessionrepo.Publisher)),
    ProvideWatermill,
    ProvideRelay,
)
```

Subscribing a policy, in `ProvideBuses`, and reading every topic, in
`ProvideRelay`:

```go
users := userbus.NewInProc(userdto.Topic)
users.Subscribe(userevent.TopicPasswordChanged, revoke.Handle)

userrepo.Handle(relay, buses.Users)       // every topic, not only the listened-to ones
sessionrepo.Handle(relay, buses.Sessions)
lockoutrepo.Handle(relay, buses.Lockouts)
```

The App:

```go
type App struct {
    Handler http.Handler
    Driver  *postgres.Store
    Relay   *sdkoutbox.Relay
    Cache   sdkcache.Cache
}
func (a App) Run(ctx context.Context) error  // relay.Run; the only blocking part
func (a App) Close()                         // relay, cache if io.Closer, driver
```
