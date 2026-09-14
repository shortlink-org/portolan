# Roadmap

What is planned and not yet built. An item leaves this file when it lands.

## Extractors

### Go: unpack embedded structs and interfaces

An embedded field is read as one field named after its type, so an event that
embeds `ddd.Base` lists a `ddd.Base` row instead of the `aggregateID` and
`occurredAt` it actually carries, and an interface that embeds another lists
nothing of the embedded method set.

The reader should resolve the embedded type - in the same package, or in an
imported one reached through the module's `replace` directives and the module
cache - and splice its fields and methods in place of the embedded row,
recursively. When the package cannot be found, today's behaviour stays.

Follows the `pkg/ddd/event` change that made embedding `Base` the house style
for domain events.
