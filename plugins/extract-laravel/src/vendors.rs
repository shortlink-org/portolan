//! What the application runs that it did not write: the composer packages
//! under `vendor/`, which are never read, named by the namespaces they
//! autoload. An event class the tree listens to or dispatches without
//! declaring it - `Illuminate\Auth\Events\PasswordReset`,
//! `Prettus\Repository\Events\RepositoryEntityDeleted` - is one of theirs,
//! and this says whose: the package composer.lock autoloads the namespace
//! from, the longest prefix winning.

use std::fs;
use std::path::Path;

#[derive(Debug, Default)]
pub struct Vendors {
    /// `Prettus\Repository\` → `prettus/l5-repository`, longest prefix first.
    prefixes: Vec<(String, String)>,
}

impl Vendors {
    /// composer.lock's packages, dev ones included; nothing when there is no lock.
    pub fn read(root: &Path) -> Vendors {
        let Ok(text) = fs::read_to_string(root.join("composer.lock")) else {
            return Vendors::default();
        };
        let Ok(lock) = serde_json::from_str::<serde_json::Value>(&text) else {
            return Vendors::default();
        };
        let mut prefixes = Vec::new();
        for list in ["packages", "packages-dev"] {
            let Some(packages) = lock.get(list).and_then(|v| v.as_array()) else {
                continue;
            };
            for package in packages {
                let Some(name) = package.get("name").and_then(|v| v.as_str()) else { continue };
                for kind in ["psr-4", "psr-0"] {
                    let Some(map) = package.pointer(&format!("/autoload/{kind}")).and_then(|v| v.as_object()) else {
                        continue;
                    };
                    for prefix in map.keys() {
                        let prefix = prefix.trim_start_matches('\\');
                        if !prefix.is_empty() {
                            prefixes.push((prefix.to_string(), name.to_string()));
                        }
                    }
                }
            }
        }
        Vendors::new(prefixes)
    }

    pub fn new(mut prefixes: Vec<(String, String)>) -> Vendors {
        prefixes.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
        Vendors { prefixes }
    }

    /// The package a class comes from: the lock's word for it, Laravel's own
    /// namespace when there is no lock, else the namespace's first segment -
    /// `Prettus` - which is what the code itself says.
    pub fn package_of(&self, class: &str) -> String {
        let class = class.trim_start_matches('\\');
        if let Some((_, name)) = self.prefixes.iter().find(|(prefix, _)| class.starts_with(prefix.as_str())) {
            return name.clone();
        }
        if class.starts_with("Illuminate\\") {
            return "laravel/framework".into();
        }
        class.split('\\').next().unwrap_or(class).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_package_a_namespace_is_autoloaded_from() {
        let vendors = Vendors::new(vec![
            ("Prettus\\Repository\\".into(), "prettus/l5-repository".into()),
            ("Prettus\\Validator\\".into(), "prettus/laravel-validation".into()),
            ("Illuminate\\".into(), "laravel/framework".into()),
            ("Illuminate\\Support\\".into(), "illuminate/support".into()),
        ]);
        assert_eq!(
            vendors.package_of("Prettus\\Repository\\Events\\RepositoryEntityDeleted"),
            "prettus/l5-repository"
        );
        assert_eq!(vendors.package_of("\\Illuminate\\Auth\\Events\\PasswordReset"), "laravel/framework");
        assert_eq!(vendors.package_of("Illuminate\\Support\\Str"), "illuminate/support");
        assert_eq!(vendors.package_of("Spatie\\Things\\Done"), "Spatie");
        assert_eq!(Vendors::default().package_of("Illuminate\\Auth\\Events\\Login"), "laravel/framework");
    }
}
