//! The use cases, read off `Application/`.
//!
//! A command is a class handed to a `CommandHandler`, a query one handed to
//! a `QueryHandler`; the handler's `__invoke` parameter names it, and the
//! operation is called after the message with its suffix taken off:
//! `CreateCourseCommand` → `CreateCourse`. The handler hands the work to a
//! use case it holds - `CourseCreator` - whose docblock is the operation's
//! when the handler has none.
//!
//! A subscriber implements `DomainEventSubscriber` and says in
//! `subscribedTo()` which event classes it reacts to; `DomainEvent::class`
//! there means every one.

use crate::ids::short;
use crate::source::{ClassInfo, ClassKind, SourceFile, Tree, Val, summary};

#[derive(Debug, Clone)]
pub struct Operation<'a> {
    /// `CreateCourse`.
    pub id: String,
    /// command or query.
    pub kind: String,
    pub doc: String,
    /// The command or query class, by full name.
    pub message: String,
    pub handler: &'a ClassInfo,
    pub file: &'a SourceFile,
}

#[derive(Debug, Clone)]
pub struct Subscriber<'a> {
    pub class: &'a ClassInfo,
    pub file: &'a SourceFile,
    /// Event classes by full name; `*` for `DomainEvent::class`, every event.
    pub events: Vec<String>,
}

pub fn is_handler(class: &ClassInfo) -> Option<&'static str> {
    if class.kind != ClassKind::Class || class.is_abstract {
        return None;
    }
    if class.implements.iter().any(|i| short(i) == "CommandHandler") {
        Some("command")
    } else if class.implements.iter().any(|i| short(i) == "QueryHandler") {
        Some("query")
    } else {
        None
    }
}

pub fn is_subscriber(class: &ClassInfo) -> bool {
    class.kind == ClassKind::Class && !class.is_abstract && class.implements.iter().any(|i| short(i) == "DomainEventSubscriber")
}

/// Every operation in the tree, in file order.
pub fn operations(tree: &Tree) -> Vec<Operation<'_>> {
    let mut out = Vec::new();
    for (file, class) in tree.classes() {
        let Some(kind) = is_handler(class) else { continue };
        let Some(invoke) = class.method("__invoke") else { continue };
        let Some(message) = invoke.params.first().and_then(|p| p.class.clone()) else { continue };
        let suffix = if kind == "command" { "Command" } else { "Query" };
        let id = short(&message).trim_end_matches(suffix).to_string();
        let mut doc = summary(&class.doc);
        if doc.is_empty() {
            // The use case the handler holds is where the sentence is.
            doc = class
                .constructor()
                .and_then(|c| c.params.iter().find_map(|p| p.class.as_deref().and_then(|c| tree.class(c))))
                .map(|c| summary(&c.doc))
                .unwrap_or_default();
        }
        if doc.is_empty() {
            doc = tree.class(&message).map(|c| summary(&c.doc)).unwrap_or_default();
        }
        out.push(Operation {
            id,
            kind: kind.into(),
            doc,
            message,
            handler: class,
            file,
        });
    }
    out
}

pub fn subscribers(tree: &Tree) -> Vec<Subscriber<'_>> {
    let mut out = Vec::new();
    for (file, class) in tree.classes() {
        if !is_subscriber(class) {
            continue;
        }
        let events: Vec<String> = class
            .method("subscribedTo")
            .and_then(|m| m.returns.iter().find_map(|v| v.as_arr().map(|a| a.to_vec())))
            .map(|items| {
                items
                    .iter()
                    .filter_map(|(_, v)| match v {
                        Val::Class(c) if short(c) == "DomainEvent" => Some("*".to_string()),
                        Val::Class(c) => Some(c.clone()),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.push(Subscriber { class, file, events });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_operations_after_their_messages_and_reads_subscriptions() {
        let tree = Tree::from_sources(&[
            ("src/Mooc/Courses/Application/Create/CreateCourseCommand.php", "<?php\nnamespace A\\Mooc\\Courses\\Application\\Create;\nfinal class CreateCourseCommand implements Command {}\n"),
            ("src/Mooc/Courses/Application/Create/CourseCreator.php", "<?php\nnamespace A\\Mooc\\Courses\\Application\\Create;\n/** Turns a name and a duration into a course. */\nfinal class CourseCreator {}\n"),
            (
                "src/Mooc/Courses/Application/Create/CreateCourseCommandHandler.php",
                "<?php\nnamespace A\\Mooc\\Courses\\Application\\Create;\nuse A\\Shared\\Domain\\Bus\\Command\\CommandHandler;\nfinal class CreateCourseCommandHandler implements CommandHandler { public function __construct(private CourseCreator $creator) {} public function __invoke(CreateCourseCommand $command): void {} }\n",
            ),
            (
                "src/Mooc/Courses/Application/Find/FindCourseQueryHandler.php",
                "<?php\nnamespace A\\Mooc\\Courses\\Application\\Find;\nuse A\\Shared\\Domain\\Bus\\Query\\QueryHandler;\n/** One course by id. */\nfinal class FindCourseQueryHandler implements QueryHandler { public function __invoke(FindCourseQuery $query): CourseResponse {} }\n",
            ),
            (
                "src/Backoffice/Courses/Application/Create/CreateBackofficeCourseOnCourseCreated.php",
                "<?php\nnamespace A\\Backoffice\\Courses\\Application\\Create;\nuse A\\Mooc\\Courses\\Domain\\CourseCreatedDomainEvent;\nuse A\\Shared\\Domain\\Bus\\Event\\DomainEventSubscriber;\nfinal class CreateBackofficeCourseOnCourseCreated implements DomainEventSubscriber { public static function subscribedTo(): array { return [CourseCreatedDomainEvent::class]; } }\n",
            ),
            (
                "src/Analytics/DomainEvents/Application/Store/StoreDomainEventOnOccurred.php",
                "<?php\nnamespace A\\Analytics\\DomainEvents\\Application\\Store;\nuse A\\Shared\\Domain\\Bus\\Event\\DomainEvent;\nuse A\\Shared\\Domain\\Bus\\Event\\DomainEventSubscriber;\nfinal class StoreDomainEventOnOccurred implements DomainEventSubscriber { public static function subscribedTo(): array { return [DomainEvent::class]; } }\n",
            ),
        ]);
        let ops = operations(&tree);
        assert_eq!(ops.iter().map(|o| format!("{} {} {}", o.kind, o.id, o.doc)).collect::<Vec<_>>(), ["command CreateCourse Turns a name and a duration into a course.", "query FindCourse One course by id."]);
        let subs = subscribers(&tree);
        assert_eq!(subs.iter().map(|s| format!("{} -> {}", s.class.name, s.events.join(","))).collect::<Vec<_>>(), [
            "CreateBackofficeCourseOnCourseCreated -> A\\Mooc\\Courses\\Domain\\CourseCreatedDomainEvent",
            "StoreDomainEventOnOccurred -> *",
        ]);
    }
}
