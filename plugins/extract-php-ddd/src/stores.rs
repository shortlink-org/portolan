//! The store, read off what maps the model to it.
//!
//! Doctrine's XML mappings say which table an aggregate is kept in and which
//! column each of its fields and embedded value objects becomes; a joined
//! subclass gets its own table keyed to the parent's. A repository adapter
//! under `Infrastructure/Persistence` says what kind of store the port is
//! answered by - `DoctrineRepository` and a `MySql` name are the relational
//! one, `ElasticsearchRepository` an index, `InMemory` and `File` nothing the
//! catalog keeps - and what it does to it: `save` writes, `search` reads.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::ForeignKey;
use crate::ids::short;
use crate::source::{ClassInfo, ClassKind, SourceFile, Tree};

#[derive(Debug, Clone)]
pub struct ColumnDef {
    pub name: String,
    pub type_: String,
    pub nullable: bool,
    pub pk: bool,
    pub fk: Option<ForeignKey>,
    /// The entity field the column carries, `name`, `total`.
    pub field: String,
}

#[derive(Debug, Clone)]
pub struct Mapping {
    pub entity: String,
    pub table: String,
    pub columns: Vec<ColumnDef>,
    /// The entity this one is a joined subclass of.
    pub parent: Option<String>,
    pub file: PathBuf,
}

struct Embeddable {
    fields: Vec<(String, String, String)>, // (field, column, type)
}

/// Every mapped entity under the paths given, joined subclasses keyed to
/// their parents' tables. Files are read in path order.
pub fn read_mappings(files: &[PathBuf]) -> Vec<Mapping> {
    let mut embeddables: BTreeMap<String, Embeddable> = BTreeMap::new();
    let mut raw: Vec<(Mapping, Vec<(String, String, bool)>, Vec<String>)> = Vec::new(); // (mapping, embedded (field, class, prefix), discriminator subclasses)
    let mut sorted: Vec<&PathBuf> = files.iter().collect();
    sorted.sort();
    for file in sorted {
        let Ok(text) = fs::read_to_string(file) else { continue };
        let Ok(doc) = roxmltree::Document::parse(&text) else { continue };
        for node in doc.descendants() {
            match node.tag_name().name() {
                "embeddable" => {
                    let Some(name) = node.attribute("name") else { continue };
                    let fields = node
                        .children()
                        .filter(|c| c.tag_name().name() == "field")
                        .filter_map(|f| Some((f.attribute("name")?.to_string(), f.attribute("column").unwrap_or(f.attribute("name")?).to_string(), type_of(f))))
                        .collect();
                    embeddables.insert(name.trim_start_matches('\\').to_string(), Embeddable { fields });
                }
                "entity" => {
                    let (Some(name), Some(table)) = (node.attribute("name"), node.attribute("table")) else { continue };
                    let mut columns = Vec::new();
                    let mut embedded = Vec::new();
                    let mut subclasses = Vec::new();
                    for child in node.children() {
                        match child.tag_name().name() {
                            "id" => {
                                let field = child.attribute("name").unwrap_or("id").to_string();
                                columns.push(ColumnDef {
                                    name: child.attribute("column").unwrap_or(&field).to_string(),
                                    type_: type_of(child),
                                    nullable: false,
                                    pk: true,
                                    fk: None,
                                    field,
                                });
                            }
                            "field" => {
                                let field = child.attribute("name").unwrap_or_default().to_string();
                                columns.push(ColumnDef {
                                    name: child.attribute("column").unwrap_or(&field).to_string(),
                                    type_: type_of(child),
                                    nullable: child.attribute("nullable") == Some("true"),
                                    pk: false,
                                    fk: None,
                                    field,
                                });
                            }
                            "embedded" => {
                                if let (Some(field), Some(class)) = (child.attribute("name"), child.attribute("class")) {
                                    embedded.push((field.to_string(), class.trim_start_matches('\\').to_string(), child.attribute("use-column-prefix") != Some("false")));
                                }
                            }
                            "discriminator-column" => {
                                // Doctrine's, not the model's: no field maps to it.
                                columns.push(ColumnDef {
                                    name: child.attribute("name").unwrap_or("type").to_string(),
                                    type_: type_of(child),
                                    nullable: false,
                                    pk: false,
                                    fk: None,
                                    field: String::new(),
                                });
                            }
                            "discriminator-map" => {
                                for m in child.children().filter(|c| c.tag_name().name() == "discriminator-mapping") {
                                    if let Some(class) = m.attribute("class") {
                                        subclasses.push(class.trim_start_matches('\\').to_string());
                                    }
                                }
                            }
                            "many-to-one" | "one-to-one" => {
                                if let Some(field) = child.attribute("field") {
                                    let column = child.children().find(|c| c.tag_name().name() == "join-column").and_then(|j| j.attribute("name")).unwrap_or(field).to_string();
                                    columns.push(ColumnDef {
                                        name: column,
                                        type_: "association".into(),
                                        nullable: false,
                                        pk: false,
                                        fk: None,
                                        field: field.to_string(),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                    raw.push((
                        Mapping {
                            entity: name.trim_start_matches('\\').to_string(),
                            table: table.to_string(),
                            columns,
                            parent: None,
                            file: file.clone(),
                        },
                        embedded,
                        subclasses,
                    ));
                }
                _ => {}
            }
        }
    }
    // Joined subclasses: the parent's discriminator map names them; each
    // gets the parent's key as its own, pointing back.
    let parents: BTreeMap<String, (String, String, String)> = raw
        .iter()
        .flat_map(|(m, _, subs)| {
            let key = m.columns.iter().find(|c| c.pk).map(|c| (c.name.clone(), c.type_.clone())).unwrap_or_else(|| ("id".into(), "string".into()));
            subs.iter().map(move |s| (s.clone(), (m.entity.clone(), key.0.clone(), key.1.clone())))
        })
        .collect();
    let table_of: BTreeMap<String, String> = raw.iter().map(|(m, _, _)| (m.entity.clone(), m.table.clone())).collect();
    let mut out = Vec::new();
    for (mut mapping, embedded, _) in raw {
        for (field, class, prefix) in embedded {
            let Some(e) = embeddables.get(&class) else { continue };
            for (sub, column, type_) in &e.fields {
                mapping.columns.push(ColumnDef {
                    name: if prefix { format!("{field}_{column}") } else { column.clone() },
                    type_: type_.clone(),
                    nullable: false,
                    pk: false,
                    fk: None,
                    field: format!("{field}.{sub}"),
                });
            }
        }
        if let Some((parent, key, key_type)) = parents.get(&mapping.entity) {
            mapping.parent = Some(parent.clone());
            if !mapping.columns.iter().any(|c| c.pk) {
                mapping.columns.insert(
                    0,
                    ColumnDef {
                        name: key.clone(),
                        type_: key_type.clone(),
                        nullable: false,
                        pk: true,
                        fk: table_of.get(parent).map(|t| ForeignKey {
                            table: t.clone(),
                            column: key.clone(),
                            on_delete: None,
                        }),
                        field: key.clone(),
                    },
                );
            }
        }
        out.push(mapping);
    }
    out
}

fn type_of(node: roxmltree::Node) -> String {
    let base = node.attribute("type").unwrap_or("string").to_string();
    match node.attribute("length") {
        Some(len) if base == "string" => format!("string({len})"),
        _ => base,
    }
}

/// Every `*.orm.xml` under a directory.
pub fn mapping_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(dir, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.to_string_lossy().ends_with(".orm.xml") {
            out.push(path);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Relational,
    Elasticsearch,
    Memory,
}

#[derive(Debug, Clone)]
pub struct Adapter<'a> {
    pub class: &'a ClassInfo,
    pub file: &'a SourceFile,
    /// The `*Repository` port it answers, by full name.
    pub port: String,
    pub backend: Backend,
    /// What an Elasticsearch adapter's `aggregateName()` answers: the index.
    pub index: Option<String>,
}

/// Every class implementing a `*Repository` interface, with the store it speaks to.
pub fn adapters(tree: &Tree) -> Vec<Adapter<'_>> {
    let mut out = Vec::new();
    for (file, class) in tree.classes() {
        if class.kind != ClassKind::Class || class.is_abstract {
            continue;
        }
        let Some(port) = class.implements.iter().find(|i| short(i).ends_with("Repository")) else { continue };
        let name = class.name.as_str();
        let backend = if name.starts_with("InMemory") || name.starts_with("File") || name.starts_with("Fake") {
            Backend::Memory
        } else if name.contains("Elasticsearch") || crate::domain::descends_from(tree, class, "ElasticsearchRepository") {
            Backend::Elasticsearch
        } else if name.contains("Doctrine") || name.contains("MySql") || name.contains("Postgres") || crate::domain::descends_from(tree, class, "DoctrineRepository") {
            Backend::Relational
        } else {
            continue;
        };
        let index = class.method("aggregateName").and_then(|m| m.returns.iter().find_map(|v| v.as_str().map(String::from)));
        out.push(Adapter {
            class,
            file,
            port: port.clone(),
            backend,
            index,
        });
    }
    out
}

/// What a repository method does to its table, by its name.
pub fn operation_of(method: &str) -> Option<&'static str> {
    match method {
        "save" | "persist" | "update" | "insert" | "saveAll" => Some("write"),
        "delete" | "remove" | "deleteAll" => Some("delete"),
        "search" | "find" | "searchAll" | "searchByCriteria" | "matching" | "all" | "get" | "count" | "exists" | "findByCriteria" => Some("read"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_doctrine_mappings_with_embeddables_and_joined_subclasses() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata").join("mooc").join("src").join("Mooc");
        let mappings = read_mappings(&mapping_files(&dir));
        let course = mappings.iter().find(|m| m.table == "courses").expect("courses");
        assert_eq!(course.columns.iter().map(|c| format!("{}:{}{}", c.name, c.type_, if c.pk { " pk" } else { "" })).collect::<Vec<_>>(), ["id:course_id pk", "name:string(255)", "duration:string"]);
        assert_eq!(course.columns[1].field, "name.value");
        let video_step = mappings.iter().find(|m| m.table == "steps_video").expect("steps_video");
        assert_eq!(video_step.parent.as_deref(), Some("Acme\\Mooc\\Steps\\Domain\\Step"));
        assert_eq!(video_step.columns[0].fk.as_ref().map(|f| f.table.as_str()), Some("steps"));
        let step = mappings.iter().find(|m| m.table == "steps").expect("steps");
        assert!(step.columns.iter().any(|c| c.name == "type"), "the discriminator is a column");
    }

    #[test]
    fn knows_a_repository_adapter_by_its_name_and_base() {
        let tree = Tree::from_sources(&[
            ("P.php", "<?php\nnamespace A\\Mooc\\Courses\\Domain;\ninterface CourseRepository {}\n"),
            ("D.php", "<?php\nnamespace A\\Mooc\\Courses\\Infrastructure\\Persistence;\nuse A\\Mooc\\Courses\\Domain\\CourseRepository;\nfinal class DoctrineCourseRepository extends DoctrineRepository implements CourseRepository { public function save($c): void {} public function search($id) {} }\n"),
            ("E.php", "<?php\nnamespace A\\Backoffice;\nfinal class ElasticsearchBackofficeCourseRepository extends ElasticsearchRepository implements BackofficeCourseRepository { protected function aggregateName(): string { return 'courses'; } }\n"),
            ("M.php", "<?php\nnamespace A\\Mooc;\nfinal class InMemoryCourseRepository implements CourseRepository {}\n"),
        ]);
        let found = adapters(&tree);
        assert_eq!(found.iter().map(|a| format!("{} {:?} {}", a.class.name, a.backend, a.index.clone().unwrap_or_default())).collect::<Vec<_>>(), [
            "DoctrineCourseRepository Relational ",
            "ElasticsearchBackofficeCourseRepository Elasticsearch courses",
            "InMemoryCourseRepository Memory ",
        ]);
        assert_eq!(operation_of("save"), Some("write"));
        assert_eq!(operation_of("searchByCriteria"), Some("read"));
    }
}
