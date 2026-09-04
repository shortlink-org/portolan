# The context in LikeC4

The model is the glossary drawn: contexts contain services, services contain
aggregates, aggregates contain events. Names are spelled as in the glossary.

## Element kinds

| Kind | Used for |
|---|---|
| `context` | a bounded context |
| `service` | a deployable inside it |
| `aggregate` | an aggregate of a service |
| `event` | a domain event of an aggregate |
| `actor` | a person or client outside the estate |
| `store` | a database a service owns |
| `broker` | the bus |
| `external` | a third party the estate calls |
| `unknown` | a peer that is called but not modelled |

## Model

```
model {
  client  = actor 'client'
  auth_pg = store 'auth-pg'
  risk_v1 = unknown 'risk.v1'

  auth = context 'Authentication' {
    description 'Who someone is, and whether they are still logged in.'
    auth = service 'Authentication & Sessions' {
      user = aggregate 'User' {
        UserRegistered  = event 'UserRegistered'
        PasswordChanged = event 'PasswordChanged'
      }
      session = aggregate 'Session' {
        SessionStarted = event 'SessionStarted'
        SessionEnded   = event 'SessionEnded'
      }
    }
  }

  client    -> auth.auth 'Login'
  auth.auth -> auth_pg
  auth.auth -> risk_v1 'Assess'
}
```

## Views

One per context, one per service, and a dynamic view per flow:

```
views {
  view ctx_auth of auth { title 'Authentication'; include * }
  view svc_auth of auth.auth { title 'Authentication & Sessions'; include *, -> *, * -> }

  dynamic view flow_login {
    title 'Login'
    client -> auth.auth 'POST /v1/sessions'
    auth.auth -> auth_pg 'SELECT users'
    auth.auth -> risk_v1 'Assess'
    alt {
      when 'allow' { auth.auth -> auth_pg 'INSERT sessions' }
      else 'block' { auth.auth -> auth_pg 'UPDATE sessions (revoke all)' }
    }
  }
}
```

Relations are named with the glossary verb or the route. A peer that is
called but not in the model is `unknown`, not omitted: the diagram should
show the call even when the far end is not known.
