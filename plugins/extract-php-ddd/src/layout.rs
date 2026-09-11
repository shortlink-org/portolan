//! The layout, which is the claim.
//!
//! ```text
//! src/<Context>/<Module>/Domain          the model: root, entities, value objects, events, ports
//! src/<Context>/<Module>/Application     the use cases: commands, queries, their handlers, subscribers
//! src/<Context>/<Module>/Infrastructure  the adapters: repositories, Doctrine mappings
//! src/Shared, src/<Context>/Shared       the shared kernel: bases, ids, not a context or a module
//! apps/<context>/<app>                   a deployable: config/routes/*.yaml, src/Controller
//! ```
//!
//! A context is a directory under `src/`, a module a directory under it, an
//! application a directory under `apps/<context>/`. What an application
//! wires - which contexts' code it loads - is read off its Symfony services
//! configuration, because a subscriber nobody wires never runs, and a
//! controller that dispatches another context's command is a call across a
//! boundary the layout itself does not draw.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::ids::slug;

#[derive(Debug, Clone)]
pub struct Module {
    pub name: String,
    pub slug: String,
    pub dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct App {
    pub name: String,
    pub slug: String,
    pub dir: PathBuf,
    /// Index of the context the app is filed under, by its directory.
    pub context: usize,
    /// Names of the contexts whose code the app loads, `Mooc`, `Backoffice`.
    pub wires: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Context {
    pub name: String,
    pub slug: String,
    pub dir: PathBuf,
    pub modules: Vec<Module>,
    pub apps: Vec<App>,
}

/// What a tree root is, for a file to know where it was read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootKind {
    Context(usize),
    App(usize, usize),
    Shared,
}

#[derive(Debug, Default)]
pub struct Layout {
    pub contexts: Vec<Context>,
    /// Every directory the tree is read from, with what it is. A file's
    /// `module` indexes into this.
    pub roots: Vec<(PathBuf, RootKind)>,
    /// Interface → implementation, from every `Fqn: '@Fqn'` line in the
    /// Symfony wiring: which adapter answers a port when several could.
    pub aliases: BTreeMap<String, String>,
}

pub const SHARED: &str = "Shared";

pub fn read(root: &Path, source: &str, apps: &str) -> Layout {
    let source_dir = root.join(if source.is_empty() { "src" } else { source });
    let apps_dir = root.join(if apps.is_empty() { "apps" } else { apps });
    let mut layout = Layout::default();

    for dir in dirs(&source_dir) {
        let name = name_of(&dir);
        if name == SHARED {
            layout.roots.push((dir, RootKind::Shared));
            continue;
        }
        let modules = dirs(&dir)
            .into_iter()
            .filter(|d| name_of(d) != SHARED)
            .map(|d| Module {
                name: name_of(&d),
                slug: slug(&name_of(&d)),
                dir: d,
            })
            .collect();
        let index = layout.contexts.len();
        layout.roots.push((dir.clone(), RootKind::Context(index)));
        layout.contexts.push(Context {
            slug: slug(&name),
            name,
            dir,
            modules,
            apps: vec![],
        });
    }

    // The contexts' own wiring, imported by the applications: aliases live
    // there too.
    for ctx in &layout.contexts {
        let mut texts = Vec::new();
        yaml_under(&ctx.dir.join(SHARED), &mut texts);
        aliases_in(&texts.join("\n"), &mut layout.aliases);
    }
    for ctx_dir in dirs(&apps_dir) {
        let ctx_name = name_of(&ctx_dir);
        let Some(context) = layout.contexts.iter().position(|c| c.slug == slug(&ctx_name)) else { continue };
        for app_dir in dirs(&ctx_dir) {
            let name = name_of(&app_dir);
            let config = config_text(&app_dir);
            aliases_in(&config, &mut layout.aliases);
            let wires = wired_contexts(&config, &layout.contexts.iter().map(|c| c.name.clone()).collect::<Vec<_>>());
            let app_index = layout.contexts[context].apps.len();
            layout.roots.push((app_dir.clone(), RootKind::App(context, app_index)));
            layout.contexts[context].apps.push(App {
                slug: slug(&name),
                name,
                dir: app_dir,
                context,
                wires,
            });
        }
    }
    layout
}

impl Layout {
    /// The context and module a file under a context root belongs to.
    pub fn place(&self, module_index: usize, path: &Path) -> Option<(usize, Option<usize>)> {
        let (root, kind) = self.roots.get(module_index)?;
        let RootKind::Context(ctx) = kind else { return None };
        let rel = path.strip_prefix(root).ok()?;
        let first = rel.components().next()?.as_os_str().to_string_lossy().to_string();
        let module = self.contexts[*ctx].modules.iter().position(|m| m.name == first);
        Some((*ctx, module))
    }

    pub fn app_of(&self, module_index: usize) -> Option<(usize, usize)> {
        match self.roots.get(module_index)?.1 {
            RootKind::App(ctx, app) => Some((ctx, app)),
            _ => None,
        }
    }
}

fn dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !name_of(p).starts_with('.'))
        .collect();
    out.sort();
    out
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// An application's Symfony services configuration, `config/services*.yaml`
/// and `config/services/*.yaml`, as one text: these files say nothing else
/// this reads, so no YAML parser.
fn config_text(app_dir: &Path) -> String {
    let mut texts = Vec::new();
    let config = app_dir.join("config");
    for name in ["services.yaml", "services.yml", "services_test.yaml"] {
        if let Ok(t) = fs::read_to_string(config.join(name)) {
            texts.push(t);
        }
    }
    if let Ok(entries) = fs::read_dir(config.join("services")) {
        for entry in entries.flatten() {
            if let Ok(t) = fs::read_to_string(entry.path()) {
                texts.push(t);
            }
        }
    }
    texts.join("\n")
}

fn yaml_under(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            yaml_under(&path, out);
        } else if path.extension().is_some_and(|e| e == "yaml" || e == "yml")
            && let Ok(t) = fs::read_to_string(&path)
        {
            out.push(t);
        }
    }
}

/// `Acme\Courses\Domain\CourseRepository: '@Acme\Courses\Infrastructure\MySqlCourseRepository'`:
/// the interface on the left is answered by the class on the right.
fn aliases_in(text: &str, out: &mut BTreeMap<String, String>) {
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once(':') else { continue };
        let key = key.trim().trim_start_matches('\\');
        let value = value.trim().trim_matches(|c| c == '\'' || c == '"');
        let Some(target) = value.strip_prefix('@') else { continue };
        let target = target.trim_start_matches('\\');
        let is_fqn = |s: &str| s.contains('\\') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '\\');
        if is_fqn(key) && is_fqn(target) {
            out.insert(key.to_string(), target.to_string());
        }
    }
}

/// The contexts an application's Symfony configuration loads: every
/// `src/<Context>` it names, as a resource or an import.
fn wired_contexts(joined: &str, contexts: &[String]) -> Vec<String> {
    let mut out: Vec<String> = contexts
        .iter()
        .filter(|c| joined.contains(&format!("/src/{c}/")) || joined.contains(&format!("/src/{c}'")) || joined.contains(&format!("/src/{c}\"")) || joined.contains(&format!("/src/{c}\n")))
        .cloned()
        .collect();
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata").join("mooc")
    }

    #[test]
    fn reads_contexts_modules_and_apps_off_the_directories() {
        let layout = read(&fixture(), "src", "apps");
        assert_eq!(layout.contexts.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Analytics", "Backoffice", "Mooc", "Retention"]);
        let mooc = &layout.contexts[2];
        assert_eq!(mooc.modules.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["Courses", "CoursesCounter", "Notifications", "Steps", "Videos"]);
        assert_eq!(mooc.apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["backend"]);
        assert_eq!(mooc.apps[0].wires, ["Mooc"]);
        let backoffice = &layout.contexts[1];
        assert_eq!(backoffice.apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["backend", "frontend"]);
        assert_eq!(backoffice.apps[1].wires, ["Backoffice", "Mooc"]);
        assert!(layout.roots.iter().any(|(_, k)| *k == RootKind::Shared));
        assert_eq!(
            layout.aliases.get("Acme\\Backoffice\\Courses\\Domain\\BackofficeCourseRepository").map(String::as_str),
            Some("Acme\\Backoffice\\Courses\\Infrastructure\\Persistence\\ElasticsearchBackofficeCourseRepository")
        );
    }
}
