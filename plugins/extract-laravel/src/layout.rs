//! Where a Laravel application keeps its modules. A plain application is one
//! module, `app/`, with its routes beside it in `routes/`. A monolith built
//! from packages - Bagisto, and anything on Concord or nwidart/modules -
//! keeps one module per package, `packages/<Vendor>/<Name>/src`, each with
//! its own `Models/`, `Events/`, `Listeners/`, `Providers/` and `Routes/`.
//! The manifest can name either with `modules`; without it the packages
//! layout is used when it matches anything and `app` otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use crate::ids::slug;

#[derive(Debug, Clone)]
pub struct Module {
    /// `Checkout` for packages/Webkul/Checkout/src; the application's own
    /// directory name for `app`.
    pub name: String,
    pub slug: String,
    pub dir: PathBuf,
    /// Directories read for this module besides `dir`: `routes/` beside `app/`.
    pub extra: Vec<PathBuf>,
}

pub const PACKAGES: &str = "packages/*/*/src";
pub const APP: &str = "app";

/// The modules a pattern names under the root, in name order, and the
/// pattern that was used - the manifest's, or the one the tree chose.
pub fn modules(root: &Path, pattern: &str) -> (Vec<Module>, String) {
    if !pattern.is_empty() {
        return (expand(root, pattern), pattern.to_string());
    }
    let packages = expand(root, PACKAGES);
    if !packages.is_empty() {
        return (packages, PACKAGES.to_string());
    }
    (expand(root, APP), APP.to_string())
}

fn expand(root: &Path, pattern: &str) -> Vec<Module> {
    let segments: Vec<&str> = pattern.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let mut dirs = vec![root.to_path_buf()];
    for segment in &segments {
        let mut next = Vec::new();
        for dir in &dirs {
            if *segment == "*" {
                let Ok(entries) = fs::read_dir(dir) else { continue };
                let mut found: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
                found.sort();
                next.extend(found);
            } else {
                let candidate = dir.join(segment);
                if candidate.is_dir() {
                    next.push(candidate);
                }
            }
        }
        dirs = next;
    }
    // The module is named after the directory the last literal segment sits
    // in: `src` under packages/Webkul/Checkout names Checkout; `app` under the
    // root names the root.
    let literal_tail = segments.last().is_some_and(|s| *s != "*");
    let mut out: Vec<Module> = dirs
        .into_iter()
        .map(|dir| {
            let named = if literal_tail && segments.len() > 1 {
                dir.parent().unwrap_or(&dir).to_path_buf()
            } else if literal_tail {
                root.to_path_buf()
            } else {
                dir.clone()
            };
            let name = named.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let extra = if segments.len() == 1 && root.join("routes").is_dir() {
                vec![root.join("routes")]
            } else {
                vec![]
            };
            Module {
                slug: slug(&name),
                name,
                dir,
                extra,
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.dir.cmp(&b.dir)));
    out
}

/// Whether a file is one Laravel loads routes from: anything under a
/// `Routes` or `routes` directory, or a `routes.php` beside the controllers.
pub fn is_route_file(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if name == "routes.php" {
        return true;
    }
    path.parent()
        .is_some_and(|p| p.components().any(|c| c.as_os_str() == "Routes" || c.as_os_str() == "routes"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata")
    }

    #[test]
    fn finds_packages_first_and_app_otherwise() {
        let (found, used) = modules(&fixture().join("shop"), "");
        assert_eq!(used, PACKAGES);
        assert_eq!(found.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["Checkout", "Customer", "Sales"]);
        assert!(found[0].dir.ends_with("packages/Acme/Checkout/src"));
        assert!(found[0].extra.is_empty());

        let (found, used) = modules(&fixture().join("app"), "");
        assert_eq!(used, APP);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "app");
        assert_eq!(found[0].extra, vec![fixture().join("app").join("routes")]);
    }

    #[test]
    fn knows_a_route_file_by_where_it_is() {
        assert!(is_route_file(Path::new("packages/Acme/Shop/src/Routes/web.php")));
        assert!(is_route_file(Path::new("routes/api.php")));
        assert!(is_route_file(Path::new("packages/Acme/Shop/src/Http/routes.php")));
        assert!(!is_route_file(Path::new("packages/Acme/Shop/src/Http/Controllers/RoutesController.php")));
    }
}
