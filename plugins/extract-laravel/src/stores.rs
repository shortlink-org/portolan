//! The database, read the way Laravel writes it: migrations. `extract-sql`
//! reads DDL, and a Laravel schema is not DDL - it is
//! `Schema::create('orders', function (Blueprint $table) { $table->string('status')->nullable(); ... })`,
//! one migration after another, so the tables are replayed here from the
//! chains those closures make, in the order the migration files sort.
//!
//! The second half is who touches what: `Order::create(...)`,
//! `$this->model->find(...)` in a repository whose `model()` names the
//! model, `DB::table('orders')->insert(...)`, each an access of a table with
//! the operation the method name says.

use std::path::{Path, PathBuf};

use crate::catalog::{ForeignKey, TableIndex};
use crate::ids::{short, slug};
use crate::models::is_model;
use crate::source::{Base, Chain, ClassInfo, ClassKind, Tree, Val, parse_bytes};

#[derive(Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub type_: String,
    pub nullable: bool,
    pub pk: bool,
    pub fk: Option<ForeignKey>,
    pub doc: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TableDef {
    pub name: String,
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<TableIndex>,
    pub module: usize,
    pub source: PathBuf,
    pub line: u32,
}

#[derive(Debug, Default)]
pub struct Schema {
    /// In creation order.
    pub tables: Vec<TableDef>,
    pub migrations: usize,
}

pub fn is_migration(path: &Path) -> bool {
    path.parent()
        .is_some_and(|p| p.components().any(|c| c.as_os_str() == "Migrations" || c.as_os_str() == "migrations"))
}

/// Every table the migrations leave behind, replayed in file-name order,
/// which is the order Laravel runs them in.
pub fn read_schema(tree: &Tree) -> Schema {
    let mut files: Vec<&crate::source::SourceFile> = tree.files.iter().filter(|f| is_migration(&f.path)).collect();
    files.sort_by_key(|f| f.path.file_name().map(|n| n.to_os_string()));
    let mut schema = Schema {
        tables: vec![],
        migrations: files.len(),
    };
    for file in files {
        // A migration is `return new class extends Migration { up() {...} }` -
        // whose chains land on the file - or a named class with an `up`.
        let mut chains: Vec<&Chain> = file.chains.iter().collect();
        for class in file.classes.iter().chain(file.anonymous.iter()) {
            if let Some(up) = class.method("up") {
                chains.extend(up.chains.iter());
            }
        }
        for chain in chains {
            apply(&mut schema, chain, file.module, &file.path);
        }
    }
    schema
}

fn apply(schema: &mut Schema, chain: &Chain, module: usize, source: &Path) {
    let Base::Static(class) = &chain.base else { return };
    if short(class) != "Schema" {
        return;
    }
    let Some(part) = chain.parts.first() else { return };
    let Some(args) = part.args.as_ref() else { return };
    let name = args.first().and_then(Val::as_str).map(String::from);
    match part.name.as_str() {
        "create" => {
            let Some(name) = name else { return };
            schema.tables.retain(|t| t.name != name);
            let mut table = TableDef {
                name,
                columns: vec![],
                indexes: vec![],
                module,
                source: source.to_path_buf(),
                line: part.line,
            };
            if let Some(Val::Closure(body)) = args.get(1) {
                for c in body {
                    blueprint(&mut table, c);
                }
            }
            schema.tables.push(table);
        }
        "table" => {
            let Some(name) = name else { return };
            let index = match schema.tables.iter().position(|t| t.name == name) {
                Some(i) => i,
                None => {
                    // Altered here, created elsewhere - by the framework, or
                    // by a migration this tree does not hold.
                    schema.tables.push(TableDef {
                        name,
                        columns: vec![],
                        indexes: vec![],
                        module,
                        source: source.to_path_buf(),
                        line: part.line,
                    });
                    schema.tables.len() - 1
                }
            };
            if let Some(Val::Closure(body)) = args.get(1) {
                for c in body {
                    blueprint(&mut schema.tables[index], c);
                }
            }
        }
        "drop" | "dropIfExists" => {
            if let Some(name) = name {
                schema.tables.retain(|t| t.name != name);
            }
        }
        "rename" => {
            if let (Some(from), Some(to)) = (name, args.get(1).and_then(Val::as_str))
                && let Some(t) = schema.tables.iter_mut().find(|t| t.name == from)
            {
                t.name = to.to_string();
            }
        }
        _ => {}
    }
}

/// One `$table->...` line of a blueprint closure.
fn blueprint(table: &mut TableDef, chain: &Chain) {
    if !matches!(chain.base, Base::Var(_)) {
        return;
    }
    let Some(first) = chain.parts.first() else { return };
    let Some(args) = first.args.as_ref() else { return };
    let arg = |i: usize| args.get(i);
    let str_arg = |i: usize| arg(i).and_then(Val::as_str).map(String::from);
    let int_arg = |i: usize| match arg(i) {
        Some(Val::Int(n)) => Some(*n),
        _ => None,
    };
    let names = |i: usize| -> Vec<String> {
        match arg(i) {
            Some(Val::Arr(items)) => items.iter().filter_map(|(_, v)| v.as_str()).map(String::from).collect(),
            Some(Val::Str(s)) => vec![s.clone()],
            _ => vec![],
        }
    };
    let modifiers = &chain.parts[1..];
    let has = |name: &str| modifiers.iter().any(|p| p.name == name && p.args.is_some());
    let modifier_arg = |name: &str, i: usize| modifiers.iter().find(|p| p.name == name).and_then(|p| p.args.as_ref()).and_then(|a| a.get(i));

    let mut add = |name: String, type_: String, nullable: bool, pk: bool, fk: Option<ForeignKey>| {
        let nullable = nullable || (has("nullable") && !matches!(modifier_arg("nullable", 0), Some(Val::Bool(false))));
        let type_ = if has("unsigned") && !type_.contains("unsigned") {
            format!("{type_} unsigned")
        } else {
            type_
        };
        let doc = modifier_arg("comment", 0).and_then(Val::as_str).map(String::from);
        let pk = pk || has("primary");
        let column = ColumnDef {
            name: name.clone(),
            type_,
            nullable,
            pk,
            fk,
            doc,
        };
        match table.columns.iter_mut().find(|c| c.name == name) {
            Some(existing) if has("change") => *existing = column,
            Some(_) => {}
            None => table.columns.push(column),
        }
        if has("unique") {
            table.indexes.push(TableIndex {
                name: modifier_arg("unique", 0)
                    .and_then(Val::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| format!("{}_{name}_unique", table.name)),
                columns: vec![name.clone()],
                unique: true,
            });
        }
        if has("index") {
            table.indexes.push(TableIndex {
                name: modifier_arg("index", 0)
                    .and_then(Val::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| format!("{}_{name}_index", table.name)),
                columns: vec![name.clone()],
                unique: false,
            });
        }
    };

    let on_delete = || -> Option<String> {
        if has("cascadeOnDelete") {
            return Some("cascade".into());
        }
        if has("nullOnDelete") {
            return Some("set null".into());
        }
        if has("restrictOnDelete") {
            return Some("restrict".into());
        }
        modifier_arg("onDelete", 0).and_then(Val::as_str).map(|s| s.to_ascii_lowercase())
    };

    match first.name.as_str() {
        "id" => add(str_arg(0).unwrap_or_else(|| "id".into()), "bigint unsigned".into(), false, true, None),
        "increments" | "tinyIncrements" | "smallIncrements" | "mediumIncrements" | "bigIncrements" => {
            let Some(name) = str_arg(0) else { return };
            let t = match first.name.as_str() {
                "bigIncrements" => "bigint unsigned",
                "tinyIncrements" => "tinyint unsigned",
                "smallIncrements" => "smallint unsigned",
                "mediumIncrements" => "mediumint unsigned",
                _ => "int unsigned",
            };
            add(name, t.into(), false, true, None);
        }
        "string" | "char" => {
            let Some(name) = str_arg(0) else { return };
            let len = int_arg(1).unwrap_or(255);
            add(
                name,
                format!("{}({len})", if first.name == "char" { "char" } else { "varchar" }),
                false,
                false,
                None,
            );
        }
        "text" | "mediumText" | "longText" | "tinyText" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "text".into(), false, false, None);
        }
        "integer"
        | "tinyInteger"
        | "smallInteger"
        | "mediumInteger"
        | "bigInteger"
        | "unsignedInteger"
        | "unsignedTinyInteger"
        | "unsignedSmallInteger"
        | "unsignedMediumInteger"
        | "unsignedBigInteger" => {
            let Some(name) = str_arg(0) else { return };
            let base = first.name.trim_start_matches("unsigned");
            let base = match base {
                "integer" | "Integer" => "int",
                "tinyInteger" | "TinyInteger" => "tinyint",
                "smallInteger" | "SmallInteger" => "smallint",
                "mediumInteger" | "MediumInteger" => "mediumint",
                _ => "bigint",
            };
            let unsigned = first.name.starts_with("unsigned") || matches!(arg(2), Some(Val::Bool(true)));
            add(name, if unsigned { format!("{base} unsigned") } else { base.into() }, false, false, None);
        }
        "foreignId" | "foreignUuid" | "foreignUlid" => {
            let Some(name) = str_arg(0) else { return };
            let t = match first.name.as_str() {
                "foreignUuid" => "char(36)",
                "foreignUlid" => "char(26)",
                _ => "bigint unsigned",
            };
            let fk = if has("constrained") {
                let table = modifier_arg("constrained", 0)
                    .and_then(Val::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| pluralize(name.trim_end_matches("_id")));
                let column = modifier_arg("constrained", 1)
                    .and_then(Val::as_str)
                    .map(String::from)
                    .unwrap_or_else(|| "id".into());
                Some(ForeignKey {
                    table,
                    column,
                    on_delete: on_delete(),
                })
            } else {
                None
            };
            add(name, t.into(), false, false, fk);
        }
        "boolean" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "boolean".into(), false, false, None);
        }
        "decimal" | "unsignedDecimal" => {
            let Some(name) = str_arg(0) else { return };
            let p = int_arg(1).unwrap_or(8);
            let s = int_arg(2).unwrap_or(2);
            let t = if first.name == "unsignedDecimal" {
                format!("decimal({p},{s}) unsigned")
            } else {
                format!("decimal({p},{s})")
            };
            add(name, t, false, false, None);
        }
        "float" | "double" => {
            let Some(name) = str_arg(0) else { return };
            add(name, first.name.clone(), false, false, None);
        }
        "date" | "time" | "timeTz" | "year" => {
            let Some(name) = str_arg(0) else { return };
            add(name, first.name.trim_end_matches("Tz").to_string(), false, false, None);
        }
        "dateTime" | "dateTimeTz" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "datetime".into(), false, false, None);
        }
        "timestamp" | "timestampTz" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "timestamp".into(), false, false, None);
        }
        "timestamps" | "timestampsTz" | "nullableTimestamps" => {
            add("created_at".into(), "timestamp".into(), true, false, None);
            add("updated_at".into(), "timestamp".into(), true, false, None);
        }
        "softDeletes" | "softDeletesTz" => add(str_arg(0).unwrap_or_else(|| "deleted_at".into()), "timestamp".into(), true, false, None),
        "rememberToken" => add("remember_token".into(), "varchar(100)".into(), true, false, None),
        "json" | "jsonb" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "json".into(), false, false, None);
        }
        "uuid" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "char(36)".into(), false, false, None);
        }
        "ulid" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "char(26)".into(), false, false, None);
        }
        "ipAddress" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "varchar(45)".into(), false, false, None);
        }
        "macAddress" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "varchar(17)".into(), false, false, None);
        }
        "binary" => {
            let Some(name) = str_arg(0) else { return };
            add(name, "blob".into(), false, false, None);
        }
        "enum" | "set" => {
            let Some(name) = str_arg(0) else { return };
            let values: Vec<String> = names(1).into_iter().map(|v| format!("'{v}'")).collect();
            add(name, format!("{}({})", first.name, values.join(",")), false, false, None);
        }
        "morphs" | "nullableMorphs" | "uuidMorphs" | "nullableUuidMorphs" => {
            let Some(name) = str_arg(0) else { return };
            let nullable = first.name.starts_with("nullable");
            let id_type = if first.name.contains("uuid") || first.name.contains("Uuid") {
                "char(36)"
            } else {
                "bigint unsigned"
            };
            add(format!("{name}_type"), "varchar(255)".into(), nullable, false, None);
            add(format!("{name}_id"), id_type.into(), nullable, false, None);
        }
        "primary" => {
            let cols = names(0);
            for c in &cols {
                if let Some(col) = table.columns.iter_mut().find(|x| &x.name == c) {
                    col.pk = true;
                }
            }
        }
        "unique" | "index" => {
            let cols = names(0);
            if cols.is_empty() {
                return;
            }
            let unique = first.name == "unique";
            let name = str_arg(1).unwrap_or_else(|| format!("{}_{}_{}", table.name, cols.join("_"), first.name));
            table.indexes.push(TableIndex { name, columns: cols, unique });
        }
        "foreign" => {
            let cols = names(0);
            let Some(col) = cols.first() else { return };
            let references = modifier_arg("references", 0)
                .and_then(Val::as_str)
                .map(String::from)
                .unwrap_or_else(|| "id".into());
            let Some(on) = modifier_arg("on", 0).and_then(Val::as_str).map(String::from) else {
                return;
            };
            if let Some(column) = table.columns.iter_mut().find(|c| &c.name == col) {
                column.fk = Some(ForeignKey {
                    table: on,
                    column: references,
                    on_delete: on_delete(),
                });
            }
        }
        "dropColumn" | "dropColumns" => {
            let cols = names(0);
            table.columns.retain(|c| !cols.contains(&c.name));
        }
        "dropTimestamps" => table.columns.retain(|c| c.name != "created_at" && c.name != "updated_at"),
        "dropSoftDeletes" => table.columns.retain(|c| c.name != str_arg(0).unwrap_or_else(|| "deleted_at".into())),
        "renameColumn" => {
            if let (Some(from), Some(to)) = (str_arg(0), str_arg(1))
                && let Some(c) = table.columns.iter_mut().find(|c| c.name == from)
            {
                c.name = to;
            }
        }
        "dropIndex" | "dropUnique" => {
            let name = str_arg(0);
            let cols = names(0);
            table.indexes.retain(|i| Some(&i.name) != name.as_ref() && i.columns != cols);
        }
        _ => {}
    }
}

/// `order_items` for OrderItem, `categories` for Category: what Eloquent
/// calls a model's table when the model does not say.
pub fn table_of_model(class: &ClassInfo) -> String {
    if let Some(Val::Str(t)) = class.prop("table").and_then(|p| p.value.as_ref()) {
        return t.clone();
    }
    pluralize(&slug(&class.name).replace('-', "_"))
}

pub fn pluralize(word: &str) -> String {
    let lower = word.to_ascii_lowercase();
    if lower.ends_with('y') && !lower.ends_with("ay") && !lower.ends_with("ey") && !lower.ends_with("oy") && !lower.ends_with("uy") {
        return format!("{}ies", &word[..word.len() - 1]);
    }
    if lower.ends_with("ss") || lower.ends_with('x') || lower.ends_with('z') || lower.ends_with("ch") || lower.ends_with("sh") {
        return format!("{word}es");
    }
    if lower.ends_with('s') {
        return word.to_string();
    }
    format!("{word}s")
}

/// The default a config file gives an environment variable:
/// `env('DB_CONNECTION', 'mysql')` in config/database.php answers `mysql`.
pub fn env_default(config: &Path, key: &str) -> Option<String> {
    let text = std::fs::read(config).ok()?;
    let file = parse_bytes(config, &text);
    let mut flat = Vec::new();
    for chain in &file.chains {
        chain.flatten(&mut flat);
    }
    flat.iter().find_map(|c| match &c.base {
        Base::Func(name, args) if short(name) == "env" && args.first().and_then(Val::as_str) == Some(key) => {
            args.get(1).and_then(Val::as_str).map(String::from)
        }
        _ => None,
    })
}

/// The catalog's kind for a Laravel connection name.
pub fn store_kind(connection: &str) -> &'static str {
    match connection {
        "pgsql" | "postgres" | "postgresql" => "postgres",
        "mysql" | "mariadb" => "mysql",
        "sqlite" => "sqlite",
        _ => "other",
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Access {
    pub table: String,
    /// read, write or delete.
    pub operation: String,
    /// `Order.create`, `orders.insert`.
    pub method: String,
}

const READS: &[&str] = &[
    "find",
    "findOrFail",
    "findMany",
    "findOrNew",
    "first",
    "firstOrFail",
    "firstWhere",
    "get",
    "all",
    "where",
    "whereIn",
    "whereNull",
    "whereNotNull",
    "whereHas",
    "count",
    "exists",
    "pluck",
    "paginate",
    "simplePaginate",
    "query",
    "with",
    "select",
    "orderBy",
    "latest",
    "oldest",
    "sum",
    "max",
    "min",
    "avg",
    "value",
    "cursor",
    "chunk",
    "newQuery",
    "toBase",
    "limit",
    "take",
    "skip",
    "groupBy",
    "having",
    "join",
    "leftJoin",
    "distinct",
    "search",
];
const WRITES: &[&str] = &[
    "create",
    "insert",
    "insertGetId",
    "insertOrIgnore",
    "update",
    "save",
    "updateOrCreate",
    "firstOrCreate",
    "upsert",
    "increment",
    "decrement",
    "push",
    "touch",
    "updateOrInsert",
    "saveMany",
    "createMany",
    "attach",
    "sync",
    "syncWithoutDetaching",
    "detach",
    "forceCreate",
    "updateQuietly",
    "saveQuietly",
];
const DELETES: &[&str] = &["delete", "destroy", "forceDelete", "truncate", "deleteQuietly"];

/// The model a class works through: itself when it is a model; the class
/// its `model()` names when it is a repository, through the Concord
/// contract when that is what it names (`OrderContract::class` → the model
/// implementing it).
pub fn model_of<'a>(tree: &'a Tree, class: &'a ClassInfo) -> Option<&'a ClassInfo> {
    if is_model(tree, class) {
        return Some(class);
    }
    let mut current = Some(class);
    let mut depth = 0;
    while let Some(c) = current {
        if let Some(m) = c.method("model") {
            let named = m.returns.iter().find_map(|v| match v {
                Val::Class(c) | Val::Str(c) => Some(c.clone()),
                _ => None,
            })?;
            return resolve_model(tree, &named);
        }
        depth += 1;
        if depth > 8 {
            break;
        }
        current = c.extends.first().and_then(|p| tree.class(p));
    }
    None
}

/// The model a name stands for: the class itself, or the model that
/// implements it when the name is an interface.
pub fn resolve_model<'a>(tree: &'a Tree, name: &str) -> Option<&'a ClassInfo> {
    let class = tree.class(name)?;
    if is_model(tree, class) {
        return Some(class);
    }
    if class.kind == ClassKind::Interface {
        return tree
            .classes()
            .map(|(_, c)| c)
            .find(|c| c.implements.iter().any(|i| i == &class.fqn) && is_model(tree, c));
    }
    None
}

/// The table access a chain makes, when it is one, seen from `owner`, the
/// class whose method holds the chain.
pub fn access_of(tree: &Tree, owner: &ClassInfo, chain: &Chain) -> Option<Access> {
    let (model, parts): (Option<&ClassInfo>, &[crate::source::Part]) = match &chain.base {
        Base::Static(class) if short(class) == "DB" => {
            let first = chain.parts.first()?;
            if first.name != "table" {
                return None;
            }
            // `DB::table('eu_withdrawals as w')`: the alias is not the table.
            let table = first.args.as_ref()?.first()?.as_str()?.split_whitespace().next()?.to_string();
            let operation = operation_of(&chain.parts[1..])?;
            let method = chain.parts[1..]
                .iter()
                .rev()
                .find(|p| p.args.is_some() && (READS.contains(&p.name.as_str()) || WRITES.contains(&p.name.as_str()) || DELETES.contains(&p.name.as_str())))
                .map(|p| p.name.clone())?;
            return Some(Access {
                method: format!("{table}.{method}"),
                table,
                operation: operation.into(),
            });
        }
        Base::Static(class) => (resolve_model(tree, class), chain.parts.as_slice()),
        Base::Var(v) if v == "this" => match chain.parts.as_slice() {
            [prop, rest @ ..] if prop.args.is_none() && prop.name == "model" => (model_of(tree, owner), rest),
            _ => return None,
        },
        _ => return None,
    };
    let model = model?;
    let operation = operation_of(parts)?;
    let method = parts
        .iter()
        .rev()
        .find(|p| p.args.is_some() && (READS.contains(&p.name.as_str()) || WRITES.contains(&p.name.as_str()) || DELETES.contains(&p.name.as_str())))
        .map(|p| p.name.clone())?;
    Some(Access {
        table: table_of_model(model),
        operation: operation.into(),
        method: format!("{}.{method}", model.name),
    })
}

/// The strongest thing a chain does to a table: delete over write over read.
fn operation_of(parts: &[crate::source::Part]) -> Option<&'static str> {
    let calls: Vec<&str> = parts.iter().filter(|p| p.args.is_some()).map(|p| p.name.as_str()).collect();
    if calls.iter().any(|c| DELETES.contains(c)) {
        Some("delete")
    } else if calls.iter().any(|c| WRITES.contains(c)) {
        Some("write")
    } else if calls.iter().any(|c| READS.contains(c)) {
        Some("read")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replays_migrations_into_tables() {
        let tree = Tree::from_sources(&[
            (
                "Database/Migrations/2024_01_01_000000_create_orders_table.php",
                "<?php\nuse Illuminate\\Database\\Migrations\\Migration;\nuse Illuminate\\Database\\Schema\\Blueprint;\nuse Illuminate\\Support\\Facades\\Schema;\nreturn new class extends Migration {\n  public function up(): void {\n    Schema::create('orders', function (Blueprint $table) {\n      $table->increments('id');\n      $table->string('increment_id')->unique();\n      $table->enum('status', ['pending', 'closed'])->nullable()->comment('Where the order is.');\n      $table->decimal('grand_total', 12, 4)->default(0);\n      $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();\n      $table->integer('items_count')->unsigned();\n      $table->timestamps();\n      $table->index(['status', 'created_at']);\n    });\n  }\n};\n",
            ),
            (
                "Database/Migrations/2024_01_02_000000_create_order_items_table.php",
                "<?php\nclass CreateOrderItemsTable extends Migration {\n  public function up() {\n    Schema::create('order_items', function (Blueprint $table) {\n      $table->id();\n      $table->unsignedInteger('order_id');\n      $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');\n      $table->softDeletes();\n    });\n  }\n}\n",
            ),
            (
                "Database/Migrations/2024_02_01_000000_alter_orders.php",
                "<?php\nreturn new class extends Migration {\n  public function up(): void {\n    Schema::table('orders', function (Blueprint $table) {\n      $table->string('channel', 64)->nullable()->after('status');\n      $table->dropColumn('items_count');\n    });\n    Schema::table('sessions', function (Blueprint $table) { $table->text('payload'); });\n  }\n};\n",
            ),
        ]);
        let schema = read_schema(&tree);
        assert_eq!(schema.migrations, 3);
        assert_eq!(
            schema.tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            ["orders", "order_items", "sessions"]
        );
        let orders = &schema.tables[0];
        let cols: Vec<String> = orders
            .columns
            .iter()
            .map(|c| format!("{}:{}{}{}", c.name, c.type_, if c.nullable { "?" } else { "" }, if c.pk { " pk" } else { "" }))
            .collect();
        assert_eq!(
            cols,
            [
                "id:int unsigned pk",
                "increment_id:varchar(255)",
                "status:enum('pending','closed')?",
                "grand_total:decimal(12,4)",
                "customer_id:bigint unsigned?",
                "created_at:timestamp?",
                "updated_at:timestamp?",
                "channel:varchar(64)?",
            ]
        );
        assert_eq!(orders.columns[2].doc.as_deref(), Some("Where the order is."));
        let fk = orders.columns[4].fk.as_ref().unwrap();
        assert_eq!(
            (fk.table.as_str(), fk.column.as_str(), fk.on_delete.as_deref()),
            ("customers", "id", Some("set null"))
        );
        assert_eq!(
            orders.indexes.iter().map(|i| (i.name.as_str(), i.unique)).collect::<Vec<_>>(),
            [("orders_increment_id_unique", true), ("orders_status_created_at_index", false)]
        );
        let items = &schema.tables[1];
        assert_eq!(
            items.columns[1].fk.as_ref().map(|f| (f.table.as_str(), f.on_delete.as_deref())),
            Some(("orders", Some("cascade")))
        );
        assert_eq!(items.columns[2].name, "deleted_at");
    }

    #[test]
    fn names_tables_the_way_eloquent_does() {
        assert_eq!(pluralize("order_item"), "order_items");
        assert_eq!(pluralize("category"), "categories");
        assert_eq!(pluralize("address"), "addresses");
        assert_eq!(pluralize("day"), "days");
        assert_eq!(pluralize("status"), "status");
        let tree = Tree::from_sources(&[(
            "M.php",
            "<?php\nnamespace A;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass OrderItem extends Model {}\nclass Usage extends Model { protected $table = 'cart_rule_coupon_usage'; }\n",
        )]);
        assert_eq!(table_of_model(tree.class("A\\OrderItem").unwrap()), "order_items");
        assert_eq!(table_of_model(tree.class("A\\Usage").unwrap()), "cart_rule_coupon_usage");
    }

    #[test]
    fn reads_accesses_through_models_repositories_and_the_query_builder() {
        let tree = Tree::from_sources(&[
            ("Contracts/Order.php", "<?php\nnamespace A\\Contracts;\ninterface Order {}\n"),
            (
                "Models/Order.php",
                "<?php\nnamespace A\\Models;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass Order extends Model implements \\A\\Contracts\\Order {}\n",
            ),
            (
                "Repositories/OrderRepository.php",
                "<?php\nnamespace A\\Repositories;\nuse A\\Contracts\\Order as OrderContract;\nuse A\\Models\\Order;\nuse Illuminate\\Support\\Facades\\DB;\nclass OrderRepository {\n  public function model(): string { return OrderContract::class; }\n  public function create(array $data) { return $this->model->create($data); }\n  public function open() { return Order::where('status', 'open')->orderBy('id')->get(); }\n  public function purge() { DB::table('order_items')->where('x', 1)->delete(); Order::query()->first(); }\n}\n",
            ),
        ]);
        let repo = tree.class("A\\Repositories\\OrderRepository").unwrap();
        let mut found = Vec::new();
        for m in &repo.methods {
            let mut flat = Vec::new();
            for c in &m.chains {
                c.flatten(&mut flat);
            }
            for c in flat {
                if let Some(a) = access_of(&tree, repo, c) {
                    found.push(format!("{} {} {}", a.operation, a.table, a.method));
                }
            }
        }
        assert_eq!(
            found,
            [
                "write orders Order.create",
                "read orders Order.get",
                "delete order_items order_items.delete",
                "read orders Order.first"
            ]
        );
    }
}
