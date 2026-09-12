# Shared types

*Generated from the portolan catalog. Do not edit by hand.*

Types named by more than one aggregate, event or message. A field that
refers to one of these is knowably the same shape everywhere it appears.

<a id="type-money"></a>

## Money

| Field | Type | Rules | Doc |
| --- | --- | --- | --- |
| `amountMinor` | `int64` | `required`, `gte 0` | Amount in the minor unit. |
| `currency` | `string` | `len 3`, `in USD, EUR`, `unique` | ISO 4217, upper case. |
