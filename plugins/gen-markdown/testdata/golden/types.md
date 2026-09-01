# Shared types

*Generated from the portolan catalog · commit `abc1234` · at 2026-01-02T03:04:05Z. Do not edit by hand.*

Types named by more than one aggregate, event or message. A field that
refers to one of these is knowably the same shape everywhere it appears.

## Money

| Field | Type | Doc |
| --- | --- | --- |
| `amountMinor` | `int64` | Amount in the minor unit. |
| `currency` | `string` | ISO 4217, upper case. |
