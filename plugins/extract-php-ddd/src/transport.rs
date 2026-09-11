//! The HTTP edge, read off `apps/<context>/<app>/config/routes/*.yaml` and
//! the controllers they name. A Symfony route file is a mapping of route
//! name to `path`, `controller` and `methods`; nothing else in it is read,
//! so the reader is a few lines and not a YAML parser. The controller's
//! `__invoke` is where the request becomes a command or a query:
//! `$this->dispatch(new CreateCourseCommand(...))`, `$this->ask(new FindVideoQuery(...))`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::source::{Base, Chain, ClassInfo, Tree, Val};

#[derive(Debug, Clone)]
pub struct Route {
    pub name: String,
    /// Upper case; empty when the file names none, which is every verb.
    pub verbs: Vec<String>,
    pub path: String,
    pub controller: String,
    pub file: PathBuf,
    pub line: u32,
}

/// Every route the application's `config/routes/*.yaml` declare, in file
/// order.
pub fn routes(app_dir: &Path) -> Vec<Route> {
    let dir = app_dir.join("config").join("routes");
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "yaml" || e == "yml"))
        .collect();
    files.sort();
    let mut out = Vec::new();
    for file in files {
        let Ok(text) = fs::read_to_string(&file) else { continue };
        out.extend(parse_routes(&text).into_iter().map(|r| Route { file: file.clone(), ..r }));
    }
    out
}

/// The route file's shape, and only it:
///
/// ```yaml
/// courses_put:
///   path: /courses/{id}
///   controller: CodelyTv\Apps\Mooc\Backend\Controller\Courses\CoursesPutController
///   methods:  [PUT]
/// ```
///
/// `methods` may also be a block list. A key under a route this does not
/// know, `defaults`, is skipped with whatever is nested under it.
pub fn parse_routes(text: &str) -> Vec<Route> {
    let mut out: Vec<Route> = Vec::new();
    let mut in_methods = false;
    for (i, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let content = line.trim();
        if indent == 0 {
            let Some(name) = content.strip_suffix(':') else { continue };
            in_methods = false;
            out.push(Route {
                name: name.trim_matches(|c| c == '"' || c == '\'').to_string(),
                verbs: vec![],
                path: String::new(),
                controller: String::new(),
                file: PathBuf::new(),
                line: i as u32 + 1,
            });
            continue;
        }
        let Some(route) = out.last_mut() else { continue };
        if in_methods {
            if let Some(item) = content.strip_prefix("- ") {
                route.verbs.push(unquote(item).to_ascii_uppercase());
                continue;
            }
            in_methods = false;
        }
        if indent != 2 {
            continue;
        }
        let Some((key, value)) = content.split_once(':') else { continue };
        let value = value.trim();
        match key.trim() {
            "path" => route.path = unquote(value).to_string(),
            "controller" => route.controller = unquote(value).trim_start_matches('\\').to_string(),
            "methods" => {
                if value.is_empty() {
                    in_methods = true;
                } else {
                    route.verbs = value.trim_matches(|c| c == '[' || c == ']').split(',').map(|v| unquote(v.trim()).to_ascii_uppercase()).filter(|v| !v.is_empty()).collect();
                }
            }
            _ => {}
        }
    }
    out.retain(|r| !r.path.is_empty());
    out
}

/// The `{id}` placeholders of a path, in order.
pub fn params_of(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = path;
    while let Some(start) = rest.find('{') {
        let Some(end) = rest[start..].find('}') else { break };
        out.push(rest[start + 1..start + end].to_string());
        rest = &rest[start + end + 1..];
    }
    out
}

fn unquote(s: &str) -> &str {
    s.trim().trim_matches(|c| c == '"' || c == '\'')
}

/// What a controller hands to the buses: (`dispatch` or `ask`, the message
/// class). Read from `__invoke` and the private methods it calls.
pub fn messages_of(tree: &Tree, controller: &ClassInfo) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut seen = Vec::new();
    collect(tree, controller, "__invoke", &mut seen, &mut out);
    out
}

fn collect(tree: &Tree, class: &ClassInfo, method: &str, seen: &mut Vec<String>, out: &mut Vec<(String, String)>) {
    if seen.contains(&method.to_string()) {
        return;
    }
    seen.push(method.to_string());
    let Some(m) = class.method(method) else { return };
    let mut flat: Vec<&Chain> = Vec::new();
    for chain in &m.chains {
        chain.flatten(&mut flat);
    }
    for chain in flat {
        let Base::Var(v) = &chain.base else { continue };
        if v != "this" {
            continue;
        }
        // `$this->ask(...)` on a base controller, or `$this->queryBus->ask(...)`
        // on a bus the controller holds.
        let part = match chain.parts.as_slice() {
            [call, ..] if call.args.is_some() => call,
            [prop, call, ..] if prop.args.is_none() && call.args.is_some() && matches!(call.name.as_str(), "dispatch" | "ask") => call,
            _ => continue,
        };
        let Some(args) = part.args.as_ref() else { continue };
        match part.name.as_str() {
            "dispatch" | "ask" => {
                if let Some(Val::Chain(inner)) = args.first()
                    && let Base::New(class, _) = &inner.base
                {
                    out.push((part.name.clone(), class.clone()));
                }
            }
            other => collect(tree, class, other, seen, out),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_symfony_route_file() {
        let routes = parse_routes(
            "courses_put:\n  path: /courses/{id}\n  controller: CodelyTv\\Apps\\Mooc\\Backend\\Controller\\Courses\\CoursesPutController\n  methods:  [PUT]\n\ncourses_get:\n  path: /courses\n  controller: 'A\\B\\CoursesGetController'\n  defaults: { auth: false }\n  methods:\n    - GET\n    - HEAD\nany_route:\n  path: /any\n  controller: A\\B\\AnyController\n",
        );
        assert_eq!(
            routes.iter().map(|r| format!("{} {} {} {} @{}", r.name, r.verbs.join("|"), r.path, r.controller, r.line)).collect::<Vec<_>>(),
            [
                "courses_put PUT /courses/{id} CodelyTv\\Apps\\Mooc\\Backend\\Controller\\Courses\\CoursesPutController @1",
                "courses_get GET|HEAD /courses A\\B\\CoursesGetController @6",
                "any_route  /any A\\B\\AnyController @13",
            ]
        );
    }

    #[test]
    fn reads_what_a_controller_dispatches_and_asks() {
        let tree = Tree::from_sources(&[(
            "C.php",
            "<?php\nnamespace A;\nuse A\\Mooc\\Courses\\Application\\Create\\CreateCourseCommand;\nfinal class CoursesPostWebController extends WebController {\n  public function __construct(private QueryBus $queryBus) {}\n  public function __invoke(Request $request) { $this->queryBus->ask(new CountCoursesQuery()); return $this->ok() ? $this->createCourse($request) : $this->ask(new FindCourseQuery($request->get('id'))); }\n  private function createCourse(Request $request) { $this->dispatch(new CreateCourseCommand((string) $request->get('id'))); return new RedirectResponse('/'); }\n}\n",
        )]);
        let controller = tree.class("A\\CoursesPostWebController").unwrap();
        assert_eq!(
            messages_of(&tree, controller),
            [
                ("ask".to_string(), "A\\CountCoursesQuery".to_string()),
                ("dispatch".to_string(), "A\\Mooc\\Courses\\Application\\Create\\CreateCourseCommand".to_string()),
                ("ask".to_string(), "A\\FindCourseQuery".to_string())
            ]
        );
    }
}
