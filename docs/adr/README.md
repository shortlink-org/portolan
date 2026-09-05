# Decision records

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:14:52+07:00. Do not edit by hand.*

| ADR | Title | Status | Date | Scope |
| --- | --- | --- | --- | --- |
| [org.0001](org.0001.md) | Client proto copies live in the consumer's infrastructure layer | accepted | 2025-03-11 | org |
| [org.0002](org.0002.md) | Domain event schema version is encoded in the package path (events/v1) | accepted | 2025-05-02 | org |
| [payments.0004](payments.0004.md) | Journal entries are idempotent by (order_id, attempt) | proposed | 2026-02-09 | [payments](../payments/README.md) |
| [auth.0001](auth.0001.md) | Aggregates return their events; they do not buffer them | accepted | 2026-08-20 | [auth.auth](../auth/auth/README.md) |
| [auth.0002](auth.0002.md) | Session is its own aggregate, linked to User by id | accepted | 2026-08-20 | [auth.auth](../auth/auth/README.md) |
| [auth.0003](auth.0003.md) | Session expiry publishes no event | accepted | 2026-08-22 | [auth.auth](../auth/auth/README.md) |
| [auth.0004](auth.0004.md) | Lockout is its own aggregate, keyed by user id | accepted | 2026-09-04 | [auth.auth](../auth/auth/README.md) |
| [auth.0005](auth.0005.md) | Validation lives in constructors, as specifications, and applies when a value is made | accepted | 2026-08-22 | [auth.auth](../auth/auth/README.md) |
| [auth.0006](auth.0006.md) | A password change ends sessions through a policy, and the domains never import each other | accepted | 2026-08-22 | [auth.auth](../auth/auth/README.md) |
| [auth.0007](auth.0007.md) | Login asks a risk service, and a blocked attempt is treated as a compromise | accepted | 2026-09-04 | [auth.auth](../auth/auth/README.md) |
| [auth.0008](auth.0008.md) | A cache in front of the token lookup, and nothing else | accepted | 2026-09-01 | [auth.auth](../auth/auth/README.md) |
| [auth.0009](auth.0009.md) | A locked account answers exactly like a wrong password | accepted | 2026-09-04 | [auth.auth](../auth/auth/README.md) |
| [auth.0010](auth.0010.md) | A revocation is written to the cache, not only dropped from it | accepted | 2026-09-05 | [auth.auth](../auth/auth/README.md) |
| [auth.0011](auth.0011.md) | The relay reads every topic and hands it to a bus; policies subscribe to the bus | accepted | 2026-09-05 | [auth.auth](../auth/auth/README.md) |
| [cart.0001](cart.0001.md) | TypeScript on Node.js, and the stack around it | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0002](cart.0002.md) | A basket freezes its currency at the first item | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0003](cart.0003.md) | Line prices are captured when added, never recomputed | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0004](cart.0004.md) | Checkout confirms the session with `auth` and the total with `pricing` | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0005](cart.0005.md) | A merge moves every line or none | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0006](cart.0006.md) | Abandonment is a sweep inside the service, and it publishes | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0007](cart.0007.md) | An anonymous basket is owned by whoever holds its token | accepted | 2026-09-04 | [shop.cart](../shop/cart/README.md) |
| [cart.0008](cart.0008.md) | Events leave the service over NATS JetStream, and the outbox stays | accepted | 2026-09-05 | [shop.cart](../shop/cart/README.md) |
| [oms.0001](oms.0001.md) | Rust on Tokio, and the stack around it | accepted | 2026-09-05 | [shop.oms](../shop/oms/README.md) |
| [oms.0002](oms.0002.md) | An order is placed from a checked-out basket, not by a call | accepted | 2026-09-05 | [shop.oms](../shop/oms/README.md) |
| [oms.0003](oms.0003.md) | Lines and the total are copied from the basket, never repriced | accepted | 2026-09-05 | [shop.oms](../shop/oms/README.md) |
| [oms.0004](oms.0004.md) | Cancelling is allowed until the parcel moves | accepted | 2026-09-05 | [shop.oms](../shop/oms/README.md) |
| [oms.0005](oms.0005.md) | Confirmation waits for a payment service that does not exist yet | accepted | 2026-09-05 | [shop.oms](../shop/oms/README.md) |
