//! Events a Blade template dispatches. A view is not PHP the parser reads,
//! but it runs PHP, and a package-built storefront uses that to let other
//! packages hook into a page: Bagisto's `{!! view_render_event('bagisto.shop.products.price.after', [...]) !!}`
//! is `Event::dispatch` with the view as the payload, and a listener in
//! another package answers it. The names are read off the text - the three
//! calls below with a string literal first - and nothing else in a template
//! is.

use std::fs;
use std::path::{Path, PathBuf};

/// One `view_render_event('name', ...)`, `Event::dispatch('name', ...)` or
/// `event('name', ...)` in a template.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewDispatch {
    pub key: String,
    pub module: usize,
    pub file: PathBuf,
    pub line: u32,
}

const CALLS: &[&str] = &["view_render_event", "Event::dispatch", "event"];

/// Directories a template is never under.
const SKIP: &[&str] = &["vendor", "node_modules", ".git", "tests", "Tests"];

/// Every template under each module root, in path order.
pub fn read(roots: &[(PathBuf, usize)]) -> Vec<ViewDispatch> {
    let mut out = Vec::new();
    for (root, module) in roots {
        let mut files = Vec::new();
        walk(root, &mut files);
        files.sort();
        for file in files {
            let Ok(text) = fs::read_to_string(&file) else { continue };
            for (key, line) in dispatches(&text) {
                out.push(ViewDispatch {
                    key,
                    module: *module,
                    file: file.clone(),
                    line,
                });
            }
        }
    }
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !SKIP.contains(&name.as_str()) {
                walk(&path, out);
            }
        } else if name.ends_with(".blade.php") {
            out.push(path);
        }
    }
}

/// The names a template's text dispatches, with the line each is on.
pub fn dispatches(text: &str) -> Vec<(String, u32)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for call in CALLS {
        let mut from = 0;
        while let Some(at) = text[from..].find(call) {
            let start = from + at;
            from = start + call.len();
            // `event(` inside `view_render_event(` or `$this->event(` is not a call to `event`.
            let before = text[..start].chars().next_back();
            if before.is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '>' | ':' | '$' | '\\')) {
                continue;
            }
            let mut i = from;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if bytes.get(i) != Some(&b'(') {
                continue;
            }
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let Some(&quote) = bytes.get(i).filter(|q| matches!(q, b'\'' | b'"')) else {
                continue;
            };
            let Some(len) = text[i + 1..].find(quote as char) else { continue };
            let key = &text[i + 1..i + 1 + len];
            // A name built at runtime - `"{$prefix}.after"` - is not a name.
            if key.is_empty() || key.contains(['$', '{', '\\', '\n']) {
                continue;
            }
            let line = text[..start].matches('\n').count() as u32 + 1;
            out.push((key.to_string(), line));
        }
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_names_a_template_dispatches() {
        let text = "<div>\n  {!! view_render_event('bagisto.shop.products.price.before', ['product' => $product]) !!}\n  @php Event::dispatch( \"shop.page.shown\" ); @endphp\n  {!! view_render_event(\"{$prefix}.after\") !!}\n  {{ $this->event('not.a.dispatch') }}\n  @php event('cart.viewed', $cart) @endphp\n</div>\n";
        assert_eq!(
            dispatches(text),
            [
                ("bagisto.shop.products.price.before".to_string(), 2),
                ("shop.page.shown".to_string(), 3),
                ("cart.viewed".to_string(), 6),
            ]
        );
    }
}
