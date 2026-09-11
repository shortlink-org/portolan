//! The model, read off `Domain/`.
//!
//! The root is the class that extends `AggregateRoot`; a class extending the
//! root is an entity of the aggregate - the joined subclasses of an abstract
//! root, `VideoStep` under `Step`. A value object is what wraps one value:
//! it extends a `*ValueObject` base or `Uuid`, or it answers `value()`. An
//! event extends `DomainEvent` and says its own wire name in `eventName()`
//! and its shape in `toPrimitives()`. A `*Repository` interface is the port
//! the use cases hold. Exceptions, collections and domain services are
//! skipped: they are behaviour, not shape.

use std::path::Path;

use crate::catalog::Field;
use crate::ids::short;
use crate::source::{ClassInfo, ClassKind, SourceFile, Tree, Val};

#[derive(Debug, Clone)]
pub struct EventDecl<'a> {
    pub class: &'a ClassInfo,
    pub file: &'a SourceFile,
    /// What `eventName()` answers, when it answers a literal.
    pub wire: Option<String>,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone)]
pub struct Model<'a> {
    pub root: &'a ClassInfo,
    pub root_file: &'a SourceFile,
    pub entities: Vec<&'a ClassInfo>,
    pub values: Vec<&'a ClassInfo>,
    pub events: Vec<EventDecl<'a>>,
    pub enums: Vec<&'a ClassInfo>,
    /// The `*Repository` interfaces declared in the module.
    pub ports: Vec<&'a ClassInfo>,
}

/// Whether the class has `base` among its ancestors, in the tree or not.
pub fn descends_from(tree: &Tree, class: &ClassInfo, base: &str) -> bool {
    class.extends.iter().any(|p| short(p) == base) || tree.extends(&class.fqn, &|parent, _| short(parent) == base)
}

pub fn is_event(tree: &Tree, class: &ClassInfo) -> bool {
    class.kind == ClassKind::Class && !class.is_abstract && descends_from(tree, class, "DomainEvent")
}

fn is_value_object(tree: &Tree, class: &ClassInfo) -> bool {
    if class.kind != ClassKind::Class || class.is_abstract {
        return false;
    }
    let by_base = class.extends.iter().any(|p| {
        let s = short(p);
        s.ends_with("ValueObject") || s == "Uuid" || s == "SimpleUuid"
    }) || tree.extends(&class.fqn, &|parent, _| {
        let s = short(parent);
        s.ends_with("ValueObject") || s == "Uuid" || s == "SimpleUuid"
    });
    by_base || class.methods.iter().any(|m| m.name == "value" && m.public && !m.is_static)
}

fn is_exception(tree: &Tree, class: &ClassInfo) -> bool {
    descends_from(tree, class, "DomainError")
        || descends_from(tree, class, "Exception")
        || descends_from(tree, class, "RuntimeException")
        || descends_from(tree, class, "Error")
        || class.extends.iter().any(|p| short(p).ends_with("Exception") || short(p).ends_with("Error"))
}

/// The module's model, when its `Domain/` has a root. `dir` is the module's
/// directory; every class in a file under `Domain` is a candidate.
pub fn read<'a>(tree: &'a Tree, dir: &Path) -> Option<Model<'a>> {
    let domain = dir.join("Domain");
    let classes: Vec<(&SourceFile, &ClassInfo)> = tree.classes().filter(|(f, _)| f.path.starts_with(&domain)).collect();
    if classes.is_empty() {
        return None;
    }
    // The root extends AggregateRoot itself; an abstract root's subclasses
    // extend the root and are its entities.
    let mut roots: Vec<(&SourceFile, &ClassInfo)> = classes.iter().copied().filter(|(_, c)| c.extends.iter().any(|p| short(p) == "AggregateRoot")).collect();
    roots.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    let (root_file, root) = *roots.first()?;
    let entities: Vec<&ClassInfo> = classes
        .iter()
        .filter(|(_, c)| c.fqn != root.fqn && c.kind == ClassKind::Class && tree.extends(&c.fqn, &|parent, _| parent == root.fqn))
        .map(|(_, c)| *c)
        .collect();
    let events: Vec<EventDecl> = classes.iter().filter(|(_, c)| is_event(tree, c)).map(|(f, c)| event_decl(f, c)).collect();
    let enums: Vec<&ClassInfo> = classes.iter().filter(|(_, c)| c.kind == ClassKind::Enum).map(|(_, c)| *c).collect();
    let ports: Vec<&ClassInfo> = classes.iter().filter(|(_, c)| c.kind == ClassKind::Interface && c.name.ends_with("Repository")).map(|(_, c)| *c).collect();
    let taken: Vec<&str> = [root.fqn.as_str()]
        .into_iter()
        .chain(entities.iter().map(|c| c.fqn.as_str()))
        .chain(events.iter().map(|e| e.class.fqn.as_str()))
        .collect();
    let values: Vec<&ClassInfo> = classes
        .iter()
        .filter(|(_, c)| !taken.contains(&c.fqn.as_str()) && !is_exception(tree, c) && is_value_object(tree, c))
        .map(|(_, c)| *c)
        .collect();
    Some(Model {
        root,
        root_file,
        entities,
        values,
        events,
        enums,
        ports,
    })
}

/// A class's shape: its constructor's parameters, promoted or not, with the
/// type as written. That is where a value object or a root keeps its state.
pub fn fields_of(class: &ClassInfo) -> Vec<Field> {
    let mut out: Vec<Field> = class
        .constructor()
        .map(|c| {
            c.params
                .iter()
                .map(|p| Field {
                    name: p.name.clone(),
                    type_: if p.hint.is_empty() { "mixed".into() } else { p.hint.clone() },
                    doc: String::new(),
                })
                .collect()
        })
        .unwrap_or_default();
    // A property declared with a type and never promoted, `private array $domainEvents`.
    for p in class.props.iter().filter(|p| !p.is_static && !p.hint.is_empty()) {
        if !out.iter().any(|f| f.name == p.name) {
            out.push(Field {
                name: p.name.clone(),
                type_: p.hint.clone(),
                doc: crate::source::summary(&p.doc),
            });
        }
    }
    out
}

/// A class's shape with what it inherits: `CourseName extends
/// StringValueObject` has the parent's `value`. The walk stops at the
/// aggregate and event bases, whose bookkeeping is not the model's shape.
pub fn shape_of(tree: &Tree, class: &ClassInfo) -> Vec<Field> {
    let mut out = fields_of(class);
    let mut current = class.extends.first().filter(|p| !is_base(p)).and_then(|p| tree.class(p));
    let mut depth = 0;
    while let Some(parent) = current {
        for f in fields_of(parent) {
            if !out.iter().any(|x| x.name == f.name) {
                out.push(f);
            }
        }
        depth += 1;
        if depth > 16 {
            break;
        }
        current = parent.extends.first().filter(|p| !is_base(p)).and_then(|p| tree.class(p));
    }
    out
}

fn is_base(fqn: &str) -> bool {
    matches!(short(fqn), "AggregateRoot" | "DomainEvent")
}

fn event_decl<'a>(file: &'a SourceFile, class: &'a ClassInfo) -> EventDecl<'a> {
    let wire = class.method("eventName").and_then(|m| m.returns.iter().find_map(|v| v.as_str().map(String::from)));
    // The shape is what goes on the wire: the keys of `toPrimitives()`, typed
    // by the constructor parameter of the same name.
    let ctor = class.constructor();
    let type_of = |name: &str| -> String {
        ctor.and_then(|c| c.params.iter().find(|p| p.name == name)).map(|p| if p.hint.is_empty() { "mixed".to_string() } else { p.hint.clone() }).unwrap_or_else(|| "mixed".into())
    };
    let mut fields: Vec<Field> = class
        .method("toPrimitives")
        .and_then(|m| m.returns.iter().find_map(|v| v.as_arr().map(|items| items.to_vec())))
        .map(|items| {
            items
                .iter()
                .filter_map(|(k, _)| k.as_ref().and_then(Val::as_str).map(String::from))
                .map(|name| Field {
                    type_: type_of(&name),
                    name,
                    doc: String::new(),
                })
                .collect()
        })
        .unwrap_or_default();
    if fields.is_empty() {
        // No `toPrimitives`: the promoted constructor parameters are the shape.
        fields = ctor
            .map(|c| c.params.iter().filter(|p| p.promoted).map(|p| Field { name: p.name.clone(), type_: if p.hint.is_empty() { "mixed".into() } else { p.hint.clone() }, doc: String::new() }).collect())
            .unwrap_or_default();
    }
    EventDecl {
        class,
        file,
        wire,
        fields,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn reads_root_entities_values_events_and_ports() {
        let tree = Tree::from_sources(&[
            ("src/Shared/Domain/Aggregate/AggregateRoot.php", "<?php\nnamespace Acme\\Shared\\Domain\\Aggregate;\nabstract class AggregateRoot {}\n"),
            ("src/Shared/Domain/Bus/Event/DomainEvent.php", "<?php\nnamespace Acme\\Shared\\Domain\\Bus\\Event;\nabstract class DomainEvent {}\n"),
            ("src/Shared/Domain/ValueObject/StringValueObject.php", "<?php\nnamespace Acme\\Shared\\Domain\\ValueObject;\nabstract class StringValueObject { public function __construct(protected string $value) {} public function value(): string { return $this->value; } }\n"),
            (
                "src/Mooc/Steps/Domain/Step.php",
                "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nuse Acme\\Shared\\Domain\\Aggregate\\AggregateRoot;\n/** One thing a student does. */\nabstract class Step extends AggregateRoot { public function __construct(public readonly StepId $id, private readonly StepTitle $title) {} }\n",
            ),
            ("src/Mooc/Steps/Domain/Video/VideoStep.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain\\Video;\nuse Acme\\Mooc\\Steps\\Domain\\Step;\nfinal class VideoStep extends Step {}\n"),
            ("src/Mooc/Steps/Domain/StepTitle.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nuse Acme\\Shared\\Domain\\ValueObject\\StringValueObject;\nfinal class StepTitle extends StringValueObject {}\n"),
            ("src/Mooc/Steps/Domain/StepId.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nfinal class StepId { public function __construct(private string $value) {} public function value(): string { return $this->value; } }\n"),
            ("src/Mooc/Steps/Domain/StepNotFound.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nfinal class StepNotFound extends \\DomainException {}\n"),
            ("src/Mooc/Steps/Domain/StepRepository.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\ninterface StepRepository { public function save(Step $step): void; }\n"),
            (
                "src/Mooc/Steps/Domain/StepCreatedDomainEvent.php",
                "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nuse Acme\\Shared\\Domain\\Bus\\Event\\DomainEvent;\n/** A step exists. */\nfinal class StepCreatedDomainEvent extends DomainEvent {\n  public function __construct(string $id, private readonly string $title, private readonly int $duration) {}\n  public static function eventName(): string { return 'step.created'; }\n  public function toPrimitives(): array { return ['title' => $this->title, 'duration' => $this->duration]; }\n}\n",
            ),
            ("src/Mooc/Steps/Domain/StepKind.php", "<?php\nnamespace Acme\\Mooc\\Steps\\Domain;\nenum StepKind: string { case Video = 'video'; }\n"),
        ]);
        let model = read(&tree, &PathBuf::from("src/Mooc/Steps")).expect("a root");
        assert_eq!(model.root.name, "Step");
        assert_eq!(model.entities.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["VideoStep"]);
        let mut values: Vec<&str> = model.values.iter().map(|c| c.name.as_str()).collect();
        values.sort();
        assert_eq!(values, ["StepId", "StepTitle"]);
        assert_eq!(model.events.len(), 1);
        assert_eq!(model.events[0].wire.as_deref(), Some("step.created"));
        assert_eq!(model.events[0].fields.iter().map(|f| format!("{}:{}", f.name, f.type_)).collect::<Vec<_>>(), ["title:string", "duration:int"]);
        assert_eq!(model.enums.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["StepKind"]);
        assert_eq!(model.ports.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["StepRepository"]);
        assert_eq!(fields_of(model.root).iter().map(|f| format!("{}:{}", f.name, f.type_)).collect::<Vec<_>>(), ["id:StepId", "title:StepTitle"]);
        let title = model.values.iter().find(|c| c.name == "StepTitle").unwrap();
        assert_eq!(shape_of(&tree, title).iter().map(|f| format!("{}:{}", f.name, f.type_)).collect::<Vec<_>>(), ["value:string"], "inherited from StringValueObject");
    }
}
