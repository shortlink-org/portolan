# phpscan

A shared Rust crate, not a plugin: a PHP tree as syntax, the way
`internal/goscan` is a Go tree. Every PHP extractor asks the same things of a
tree - which classes it declares, what they extend and implement, what their
methods call - and none of them wants an AST. `extract-laravel` reads a
framework through it and `extract-php-ddd` reads a layout through it;
neither copies the parser.

## What it reads

PHP files, parsed once each with Mago (`mago-syntax`, the PHP parser written
in Rust), and read into the crate's own shapes before the arena is dropped
(`source.rs`): classes with their members, what they extend and implement,
and every call written as a chain - `Route::get(...)->name(...)`,
`$this->bus->publish(...)`, `new Event(...)`. Names are resolved by
namespace and `use` line.

## What it emits

Rust types for the two plugins that depend on it:

- `source` - the parsed tree: classes, members, call chains;
- `ids` - how a name in the source becomes an id in the catalog, spelled the
  same as the Go, TypeScript and Rust extractors spell it.

## Options

None; it is a library.

## Manifest

Nothing in a manifest names it. The plugins that depend on it are declared
as processes:

```json
{ "name": "laravel-domain", "process": { "command": "cargo", "args": ["run", "--quiet", "--manifest-path", "plugins/extract-laravel/Cargo.toml"] } }
{ "name": "php-ddd",        "process": { "command": "cargo", "args": ["run", "--quiet", "--manifest-path", "plugins/extract-php-ddd/Cargo.toml"] } }
```

Each of those `Cargo.toml` files declares `phpscan = { path = "../phpscan" }`.

## Runtime

Rust 2024 edition, built by `cargo` as a dependency of the two extractors;
`publish = false`. The `target/` directory is not committed.

## Limits

- Syntax only: no type checker, no autoloader, nothing is executed.
- What it reads is what the two extractors ask for; it is not a general PHP
  model.

## Tests

Unit tests inside `src/ids.rs` and `src/source.rs`:
`cargo test --manifest-path plugins/phpscan/Cargo.toml`.
