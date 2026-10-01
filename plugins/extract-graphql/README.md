# extract-graphql

A GraphQL schema in, the interfaces a service provides out: what a client may
ask for, what comes back, and which answers keep arriving. It reads the SDL
only - no server, no executable documents - and says nothing about who
answers underneath; the extractor that reads the resolvers reports the calls.

## What it reads

`.graphql`, `.graphqls` and `.gql` files under `schema` (one file, or a
directory read together), or - left out - walked from the input root,
skipping `node_modules`, `dist`, `vendor` and `.git`. A file whose name
contains `.generated.` is a generator's copy and is not read.

The parser (`parse.go`, `lex.go`) reads the type system language: `type`,
`interface`, `input`, `union`, `enum`, `scalar`, `schema { }` renaming the
roots, fields with arguments and defaults, `!` and `[]` wrappers, block-string
descriptions (comments are not descriptions) and `@deprecated(reason:)`.
Declarations of one type across several files merge; the file each root field
came from is kept, because that is the module that owns it.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`provides` holds one interface per schema module - `basket/schema.graphql`
and `basket.graphql` are both the module `basket`, id `<api>.Basket`; a
schema in one file lands on `<api>` itself. Each method is a root field named
by its operation (`Query.basket`, `Mutation.placeOrder`); a subscription is a
server stream. The request is the field's single input object, or an invented
`<Root><Field>Args` message carrying the loose arguments; the response is the
field's type. `messages` lists every object, input, interface and union
reached transitively, with fields spelled `[]Item`, enums as `enum(a | b)`,
nullability said as "Optional." in the prose, deprecation carried, and a
`__typename` discriminator for unions and interfaces.

A schema with no root fields warns that nothing answers over it; a module
whose root fields come from two files warns which one the interface points
at.

## Options

`context`, `service`, `schema`, `api` (default `<service>.v1`), `out`
(`graphql.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "graphql", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "graphql", "in": "examples/bff", "out": "examples/bff/portolan",
      "options": { "context": "storefront", "service": "bff", "schema": "src/schema", "api": "storefront.v1", "out": "api.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `graphql`; or `go run ./plugins/cmd/portolan-go graphql`.

## Limits

- Resolvers are not read; `extract-ts` reports what each field goes on to
  call, and spells the same ids (`extract-ts/graphql.ts` is the other copy).
- Nested lists collapse to one level (`[]Line`, never `[][]Line`).
- An unclosed string is a parse error for the file.

## Tests

`go test ./plugins/extract-graphql/...`, with a modular schema under
`testdata/schema` and a determinism test.
