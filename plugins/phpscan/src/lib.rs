//! phpscan: a PHP tree as syntax, the way `internal/goscan` is a Go tree.
//!
//! Every PHP extractor asks the same things of a tree - which classes it
//! declares, what they extend and implement, what their methods call - and
//! none of them wants an AST. `source` parses each file once with Mago and
//! reads it into the shapes those questions are asked against: classes with
//! their members, and every call written as a chain, `Route::get(...)->name(...)`,
//! `$this->bus->publish(...)`, `new Event(...)`. `ids` is how a name in the
//! source becomes an id in the catalog, spelled the same as the Go, TypeScript
//! and Rust extractors spell it.
//!
//! extract-laravel reads a framework through it; extract-php-ddd reads a
//! layout through it. Neither copies the parser.

pub mod ids;
pub mod source;
