# extract-sql

`extract-sql` reads a service's migrations into the store it builds - tables,
columns, keys, views, the aggregate each table persists - and reads the Go,
TypeScript, Rust and Java code beside them for who reads and writes each
table. It needs no database: the DDL is parsed with PostgreSQL's grammar
ported to Go.

## What is recognized

### Schema

- Up migrations (`*.sql`, not `*.down.sql`) under `migrations/` or
  `migration/` in repository and projector packages, discovered or named by
  the `repositories` and `projectors` options.
- ent schemas: a type in `ent/schema` that embeds `ent.Schema` is a table,
  added when no migration creates one of that name. The table is the
  `Table` of its `entsql.Annotation` (or of the `ent.Config` its `Config()`
  returns), else ent's name for the type (`OrderLine` is `order_lines`). Its
  `Fields()` are the columns, typed by the field builder (`string`, `time`,
  `enum(draft | placed)`); `Optional`/`Nillable` make a column nullable,
  `StorageKey` renames it, and `id` is the key ent adds unless a field
  replaces it.

### Table accesses

Each access is a `read`, `write` or `delete` of a table, credited to the
function it is written in - or, for a helper, to the methods on the same
receiver that call it - with the line as its source.

| Source | Where | Recognized |
| --- | --- | --- |
| raw SQL | repository and projector packages; every package when the migrations are not in one | any call argument that is a SQL literal, a package constant or a concatenation of them |
| gorm (`gorm.io/gorm`, `github.com/jinzhu/gorm`) | any package importing it | a chain on a `*gorm.DB` ending in `Find`, `First`, `Last`, `Take`, `Scan`, `Count`, `Pluck`, `Row(s)` (read), `Create`, `Save`, `Update(s)`, `UpdateColumn(s)` (write), `FirstOrCreate` (both), `Delete`; `Raw(sql)` and `Exec(sql)` by their statement; SQL `Joins` as reads |
| sqlx (`github.com/jmoiron/sqlx`) | any package importing it | `Get`, `Select`, `Queryx`, `QueryRowx`, `NamedExec`, `NamedQuery`, `MustExec`, `Exec`, `Query`, `QueryRow`, `Preparex`, `PrepareNamed` and their `Context` forms, as methods and as package functions; `sqlx.In` and `Rebind` are followed to the statement |
| sqlc | callers anywhere | generated `-- name: X :kind` constants; a call of the generated `X` is credited to the caller, and a query nothing calls to the generated method. With no generated code, `sqlc.yaml` (version 1 or 2) gives the query files and the package they will be generated into |
| ent | any package importing the generated `ent` package | `client.<Type>.Query/Get/GetX` (read), `Create/CreateBulk/MapCreateBulk/Update/UpdateOne/UpdateOneID` (write), `Delete/DeleteOne/DeleteOneID` (delete), on a client or a transaction |
| squirrel (`github.com/Masterminds/squirrel`) | any package importing it | `Select(...).From(t)` and every `Join`/`LeftJoin`/`RightJoin`/`InnerJoin`/`CrossJoin` (read), `Insert(t)`/`Replace(t)`/`Into(t)` and `Update(t)`/`Table(t)` (write; an `Update`'s `From` is a read), `Delete(t)`/`Delete("").From(t)`; started from the package, `StatementBuilder`, a builder-typed value or a local or package variable holding one |

A library is recognized by the import path of the file a call is in, and by
the declared type of what the call is made on where the declarations say: a
`Get` on a cache in a file that imports sqlx is not a query.

### Table names

gorm's table is the chain's `Table(...)`, else its `Model(...)`, else the
value the final call is given. A model's table is the constant its
`TableName()` returns, else gorm's name for its type (`OrderLine` is
`order_lines`, `APIKey` is `api_keys`), with a `schema.NamingStrategy`'s
`TablePrefix` and `SingularTable` applied only when the strategy is a literal
in the tree.

Every name is a literal or a constant, followed through locals, imported
constants, functions that return one, and what callers pass for a parameter.
Anything else - a `Table(name)` no caller fixes, a model of a type declared in
another module, a `TableName()` that returns a field, a strategy read from
config - is reported as a warning and the access is left out. An access through
a gorm model, an ent type or a squirrel builder to a table no migration or
schema creates is reported too.

## Left out

- gorm associations (`Preload`, `Association`) and the tables they reach;
  `AutoMigrate` as a schema source.
- ent edges: neither foreign-key columns nor `Query<Edge>` accesses; fields
  a `Mixin` contributes.
- sqlc `schema:` paths that are not a discovered migrations directory.
- Statements built with `fmt.Sprintf` or by string builders.
