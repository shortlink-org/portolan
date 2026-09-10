//! Eloquent models, and the closed sets their fields take values from.
//!
//! A model is a concrete class that extends Eloquent's `Model` - directly,
//! or through a base class of the tree's own. Its fields are what the model
//! itself writes down: `$casts` with the type as cast, `$fillable` for the
//! columns it accepts without saying their type, `$dates`, and a relation
//! per method that calls `$this->hasMany(...)` and its kin. Its enums are the
//! constant groups it keeps, `STATUS_PENDING = 'pending'` beside
//! `STATUS_CLOSED = 'closed'`, plus every PHP `enum` the module declares.

use crate::catalog::{Block, Enum, EnumValue, Field};
use crate::ids::{block_id, camel, short, slug};
use crate::source::{Base, Chain, ClassInfo, ClassKind, SourceFile, Tree, Val, summary};

pub struct Model<'a> {
    pub file: &'a SourceFile,
    pub class: &'a ClassInfo,
}

const MODEL_BASES: &[&str] = &[
    "Illuminate\\Database\\Eloquent\\Model",
    "Illuminate\\Foundation\\Auth\\User",
    "Illuminate\\Database\\Eloquent\\Relations\\Pivot",
    "Illuminate\\Database\\Eloquent\\Relations\\MorphPivot",
];

const RELATIONS: &[&str] = &[
    "hasOne",
    "hasMany",
    "belongsTo",
    "belongsToMany",
    "hasOneThrough",
    "hasManyThrough",
    "morphTo",
    "morphOne",
    "morphMany",
    "morphToMany",
    "morphedByMany",
];

/// Whether the class is an Eloquent model: it extends `Model` or one of the
/// authenticatable and pivot bases, or a class outside the tree called that.
pub fn is_model(tree: &Tree, class: &ClassInfo) -> bool {
    class.kind == ClassKind::Class
        && tree.extends(&class.fqn, &|parent, in_tree| {
            MODEL_BASES.contains(&parent) || (!in_tree && matches!(short(parent), "Model" | "Pivot" | "MorphPivot" | "Authenticatable"))
        })
}

/// The concrete models a module declares, in file order.
pub fn read_models<'a>(tree: &'a Tree, module: usize) -> Vec<Model<'a>> {
    tree.classes()
        .filter(|(f, c)| f.module == module && !c.is_abstract && is_model(tree, c))
        .map(|(file, class)| Model { file, class })
        .collect()
}

pub fn block_of(model: &Model, aggregate: &str) -> Block {
    let name = model.class.name.clone();
    Block {
        id: block_id(aggregate, &slug(&name)),
        slug: slug(&name),
        name,
        doc: summary(&model.class.doc),
        fields: fields_of(model.class),
    }
}

/// The model's fields as it declares them: the primary key, casts, the
/// fillable and guarded columns with no cast, the timestamps, then the
/// relations, each once. The key and the timestamps are Eloquent's own
/// conventions, kept unless the model turns them off.
pub fn fields_of(class: &ClassInfo) -> Vec<Field> {
    let mut out: Vec<Field> = Vec::new();
    let mut push = |name: String, type_: String| {
        if !out.iter().any(|f| f.name == name) {
            out.push(Field {
                name,
                type_,
                doc: String::new(),
            });
        }
    };
    let prop_str = |name: &str, default: &str| -> Option<String> {
        match class.prop(name).and_then(|p| p.value.as_ref()) {
            Some(Val::Str(s)) => Some(s.clone()),
            Some(Val::Null) => None,
            Some(_) => Some(default.to_string()),
            None => Some(default.to_string()),
        }
    };
    if let Some(key) = prop_str("primaryKey", "id") {
        push(key, prop_str("keyType", "int").unwrap_or_else(|| "int".into()));
    }
    let casts = class
        .prop("casts")
        .and_then(|p| p.value.clone())
        .or_else(|| class.method("casts").and_then(|m| m.returns.first().cloned()));
    if let Some(items) = casts.as_ref().and_then(Val::as_arr) {
        for (key, value) in items {
            let Some(name) = key.as_ref().and_then(Val::as_str) else { continue };
            let type_ = match value {
                Val::Str(t) => t.clone(),
                Val::Class(c) => short(c).to_string(),
                _ => "mixed".into(),
            };
            push(name.to_string(), type_);
        }
    }
    if let Some(items) = class.prop("fillable").and_then(|p| p.value.as_ref()).and_then(Val::as_arr) {
        for (_, value) in items {
            if let Some(name) = value.as_str() {
                push(name.to_string(), "mixed".into());
            }
        }
    }
    if let Some(items) = class.prop("dates").and_then(|p| p.value.as_ref()).and_then(Val::as_arr) {
        for (_, value) in items {
            if let Some(name) = value.as_str() {
                push(name.to_string(), "datetime".into());
            }
        }
    }
    if let Some(items) = class.prop("guarded").and_then(|p| p.value.as_ref()).and_then(Val::as_arr) {
        for (_, value) in items {
            if let Some(name) = value.as_str().filter(|n| *n != "*") {
                push(name.to_string(), "mixed".into());
            }
        }
    }
    if class.prop("timestamps").and_then(|p| p.value.as_ref()) != Some(&Val::Bool(false)) {
        push("created_at".into(), "datetime".into());
        push("updated_at".into(), "datetime".into());
    }
    for method in class.methods.iter().filter(|m| m.public && !m.is_static && m.params.is_empty()) {
        let mut all = Vec::new();
        for chain in &method.chains {
            chain.flatten(&mut all);
        }
        let Some(relation) = all.iter().find_map(|c| relation_of(c)) else { continue };
        let kind = if RELATIONS.iter().any(|r| r.eq_ignore_ascii_case(&method.return_hint)) {
            camel(&method.return_hint)
        } else {
            camel(relation.0)
        };
        let type_ = match relation.1 {
            Some(target) => format!("{kind}[{target}]"),
            None => kind,
        };
        push(method.name.clone(), type_);
    }
    out
}

/// `$this->hasMany(OrderItem::class, ...)` → ("hasMany", Some("OrderItem")).
fn relation_of(chain: &Chain) -> Option<(&str, Option<String>)> {
    if chain.base != Base::Var("this".into()) {
        return None;
    }
    let part = chain.parts.first()?;
    let args = part.args.as_ref()?;
    let name = RELATIONS.iter().find(|r| **r == part.name)?;
    let target = args.first().and_then(|arg| match arg {
        Val::Class(c) => Some(short(c).to_string()),
        Val::Str(s) => Some(short(s).to_string()),
        // Concord's `CartProxy::modelClass()`: the proxy stands for the model.
        Val::Chain(inner) => match &inner.base {
            Base::Static(c) if inner.parts.first().is_some_and(|p| p.name == "modelClass") => Some(short(c).trim_end_matches("Proxy").to_string()),
            _ => None,
        },
        _ => None,
    });
    Some((name, target))
}

/// The constant groups a model keeps as closed sets: two or more string
/// constants sharing a prefix, `STATUS_PENDING`, `STATUS_CLOSED`.
pub fn const_enums(class: &ClassInfo, aggregate: &str) -> Vec<Enum> {
    let mut groups: Vec<(String, Vec<&crate::source::ConstInfo>)> = Vec::new();
    for c in &class.consts {
        let Some((prefix, _)) = c.name.split_once('_') else { continue };
        if !matches!(c.value, Val::Str(_)) {
            continue;
        }
        match groups.iter_mut().find(|(p, _)| p == prefix) {
            Some((_, members)) => members.push(c),
            None => groups.push((prefix.to_string(), vec![c])),
        }
    }
    groups
        .into_iter()
        .filter(|(_, members)| members.len() >= 2)
        .map(|(prefix, members)| {
            let slug_ = format!("{}-{}", slug(&class.name), slug(&prefix));
            Enum {
                id: format!("{aggregate}.{slug_}"),
                slug: slug_,
                name: format!("{} {}", class.name, camel(&prefix.to_ascii_lowercase())),
                doc: String::new(),
                deprecated: false,
                values: members
                    .iter()
                    .map(|c| EnumValue {
                        name: c.value.as_str().unwrap_or(&c.name).to_string(),
                        doc: summary(&c.doc),
                        deprecated: c.deprecated,
                    })
                    .collect(),
            }
        })
        .collect()
}

/// A PHP `enum` as a closed set: its cases, by backing value when backed.
pub fn declared_enum(class: &ClassInfo, aggregate: &str) -> Enum {
    let slug_ = slug(&class.name);
    Enum {
        id: format!("{aggregate}.{slug_}"),
        slug: slug_,
        name: class.name.clone(),
        doc: summary(&class.doc),
        deprecated: class.deprecated(),
        values: class
            .cases
            .iter()
            .map(|c| EnumValue {
                name: match &c.value {
                    Some(Val::Str(s)) => s.clone(),
                    Some(Val::Int(i)) => i.to_string(),
                    _ => c.name.clone(),
                },
                doc: summary(&c.doc),
                deprecated: c.deprecated,
            })
            .collect(),
    }
}

/// Every closed set of a module: the declared enums, then each model's constant groups.
pub fn read_enums(tree: &Tree, module: usize, models: &[Model], aggregate: &str) -> Vec<Enum> {
    let mut out: Vec<Enum> = tree
        .classes()
        .filter(|(f, c)| f.module == module && c.kind == ClassKind::Enum)
        .map(|(_, c)| declared_enum(c, aggregate))
        .collect();
    for model in models {
        out.extend(const_enums(model.class, aggregate));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_model_through_its_own_base_class() {
        let tree = Tree::from_sources(&[
            (
                "Base.php",
                "<?php\nnamespace Acme\\Core;\nuse Illuminate\\Database\\Eloquent\\Model;\nabstract class Base extends Model {}\n",
            ),
            (
                "Order.php",
                "<?php\nnamespace Acme\\Sales\\Models;\nuse Acme\\Core\\Base;\nuse Acme\\Checkout\\Models\\CartProxy;\nclass Order extends Base {\n  public const STATUS_PENDING = 'pending';\n  /** Nothing left to do. */\n  public const STATUS_CLOSED = 'closed';\n  public const MAX = 3;\n  protected $fillable = ['status', 'total', 'placed_at'];\n  protected $casts = ['total' => 'float', 'placed_at' => 'datetime'];\n  public function items(): HasMany { return $this->hasMany(OrderItem::class); }\n  public function cart() { return $this->belongsTo(CartProxy::modelClass()); }\n  public function scopeOpen($q) { return $q->where('status', 'open'); }\n}\n",
            ),
            ("Plain.php", "<?php\nnamespace Acme\\Sales;\nclass Plain {}\n"),
        ]);
        let order = tree.class("Acme\\Sales\\Models\\Order").unwrap();
        assert!(is_model(&tree, order));
        assert!(!is_model(&tree, tree.class("Acme\\Sales\\Plain").unwrap()));
        assert!(!is_model(&tree, tree.class("Acme\\Core\\Base").unwrap()) || tree.class("Acme\\Core\\Base").unwrap().is_abstract);

        let fields: Vec<(String, String)> = fields_of(order).into_iter().map(|f| (f.name, f.type_)).collect();
        assert_eq!(
            fields,
            [
                ("id".to_string(), "int".to_string()),
                ("total".into(), "float".into()),
                ("placed_at".into(), "datetime".into()),
                ("status".into(), "mixed".into()),
                ("created_at".into(), "datetime".into()),
                ("updated_at".into(), "datetime".into()),
                ("items".into(), "HasMany[OrderItem]".into()),
                ("cart".into(), "BelongsTo[Cart]".into()),
            ]
        );

        let enums = const_enums(order, "shop.app.models-sales");
        assert_eq!(enums.len(), 1);
        assert_eq!(enums[0].id, "shop.app.models-sales.order-status");
        assert_eq!(enums[0].name, "Order Status");
        assert_eq!(enums[0].values.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), ["pending", "closed"]);
        assert_eq!(enums[0].values[1].doc, "Nothing left to do.");
    }

    #[test]
    fn keeps_eloquents_own_columns_unless_the_model_turns_them_off() {
        let tree = Tree::from_sources(&[(
            "U.php",
            "<?php\nnamespace Acme;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass Usage extends Model {\n  public $timestamps = false;\n  protected $primaryKey = 'usage_id';\n  protected $keyType = 'string';\n  protected $guarded = ['created_at', '*'];\n}\nclass Pivot extends Model { protected $primaryKey = null; }\n",
        )]);
        let usage: Vec<(String, String)> = fields_of(tree.class("Acme\\Usage").unwrap()).into_iter().map(|f| (f.name, f.type_)).collect();
        assert_eq!(usage, [("usage_id".to_string(), "string".to_string()), ("created_at".into(), "mixed".into())]);
        let pivot: Vec<String> = fields_of(tree.class("Acme\\Pivot").unwrap()).into_iter().map(|f| f.name).collect();
        assert_eq!(pivot, ["created_at", "updated_at"]);
    }

    #[test]
    fn reads_a_declared_enum_by_its_backing_values() {
        let tree = Tree::from_sources(&[(
            "S.php",
            "<?php\nnamespace Acme;\n/** Where a shipment is. */\nenum ShipmentStatus: string { case Packed = 'packed'; /** Gone. */ case Shipped = 'shipped'; }\n",
        )]);
        let e = declared_enum(tree.class("Acme\\ShipmentStatus").unwrap(), "a.b");
        assert_eq!(e.id, "a.b.shipment-status");
        assert_eq!(e.doc, "Where a shipment is.");
        assert_eq!(
            e.values.iter().map(|v| (v.name.as_str(), v.doc.as_str())).collect::<Vec<_>>(),
            [("packed", ""), ("shipped", "Gone.")]
        );
    }
}
