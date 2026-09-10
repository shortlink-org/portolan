//! The tree as syntax: every `.php` under the modules, parsed once with Mago
//! and read into the extractor's own shapes before the arena is dropped.
//! There is no type checker; names are resolved by namespace and by `use`
//! line, which is all a framework that says where things are needs.
//!
//! What a reader gets off a file is deliberately small: the classes it
//! declares - parents, traits, constants, properties, methods - and the call
//! chains its code makes, `Route::get(...)->name(...)`,
//! `Event::dispatch('...')`, `$this->orders->create(...)`, kept as chains
//! rather than as an AST so that every reader asks the same question the
//! same way.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use mago_allocator::LocalArena;
use mago_database::file::File;
use mago_span::HasSpan;
use mago_syntax::comments::docblock::get_docblock_before_position;
use mago_syntax::cst::*;
use mago_syntax::parser::parse_file;
use mago_syntax::walker::{MutWalker, walk_block_mut, walk_expression_mut, walk_namespace_mut, walk_program_mut};

/// A value an argument or a property is worth, as far as syntax says.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Str(String),
    Int(i64),
    Bool(bool),
    Null,
    /// `Foo::class`, resolved to the full name.
    Class(String),
    /// `Foo::BAR`, the class resolved; `self`, `static` and `parent` kept as written.
    ClassConst(String, String),
    /// A bare constant, `PHP_EOL`.
    Const(String),
    /// `[a, 'k' => b]`: each element with its key when it has one.
    Arr(Vec<(Option<Val>, Val)>),
    /// A call, an access, a `new` - anything with a receiver.
    Chain(Box<Chain>),
    /// `function () { ... }` or `fn () => ...`: the chains its body makes.
    Closure(Vec<Chain>),
    Other,
}

impl Val {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Val::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_class(&self) -> Option<&str> {
        match self {
            Val::Class(c) => Some(c),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&[(Option<Val>, Val)]> {
        match self {
            Val::Arr(items) => Some(items),
            _ => None,
        }
    }
    /// The value under a string key of an array literal.
    pub fn get(&self, key: &str) -> Option<&Val> {
        self.as_arr()?
            .iter()
            .find(|(k, _)| k.as_ref().and_then(Val::as_str) == Some(key))
            .map(|(_, v)| v)
    }
}

/// What a chain starts from.
#[derive(Debug, Clone, PartialEq)]
pub enum Base {
    /// `Foo::` - the class resolved; `self`, `static`, `parent` as written.
    Static(String),
    /// `foo(...)`: a function by name, with its arguments.
    Func(String, Vec<Val>),
    /// `$x`, without the dollar; `this` for `$this`.
    Var(String),
    /// `new Foo(...)`, the class resolved.
    New(String, Vec<Val>),
    Other,
}

/// One `->name(args)` or `->name` after the base.
#[derive(Debug, Clone, PartialEq)]
pub struct Part {
    pub name: String,
    /// `None` for a property access, `Some` for a call, even with no arguments.
    pub args: Option<Vec<Val>>,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chain {
    pub base: Base,
    pub parts: Vec<Part>,
    pub line: u32,
}

impl Chain {
    /// The first call on the chain, `get` in `Route::get(...)->name(...)`.
    pub fn first_call(&self) -> Option<&Part> {
        self.parts.iter().find(|p| p.args.is_some())
    }

    /// Every chain in here, this one and the ones its arguments and closures
    /// make, depth first: what a reader looking for a call anywhere walks.
    pub fn flatten<'a>(&'a self, out: &mut Vec<&'a Chain>) {
        out.push(self);
        match &self.base {
            Base::Func(_, args) | Base::New(_, args) => {
                for arg in args {
                    flatten_val(arg, out);
                }
            }
            _ => {}
        }
        for part in &self.parts {
            if let Some(args) = &part.args {
                for arg in args {
                    flatten_val(arg, out);
                }
            }
        }
    }
}

fn flatten_val<'a>(val: &'a Val, out: &mut Vec<&'a Chain>) {
    match val {
        Val::Chain(chain) => chain.flatten(out),
        Val::Closure(chains) => {
            for chain in chains {
                chain.flatten(out);
            }
        }
        Val::Arr(items) => {
            for (k, v) in items {
                if let Some(k) = k {
                    flatten_val(k, out);
                }
                flatten_val(v, out);
            }
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassKind {
    Class,
    Interface,
    Trait,
    Enum,
}

#[derive(Debug, Clone)]
pub struct ConstInfo {
    pub name: String,
    pub value: Val,
    pub doc: String,
    pub deprecated: bool,
}

#[derive(Debug, Clone)]
pub struct PropInfo {
    /// Without the dollar.
    pub name: String,
    /// The type as written, empty when there is none.
    pub hint: String,
    /// The resolved class the hint names, when it names one.
    pub class: Option<String>,
    pub value: Option<Val>,
    pub doc: String,
    pub is_static: bool,
    pub public: bool,
}

#[derive(Debug, Clone)]
pub struct Param {
    pub name: String,
    pub hint: String,
    /// The resolved class the hint names, when it names one.
    pub class: Option<String>,
    /// Constructor promotion: `public function __construct(protected Foo $foo)`.
    pub promoted: bool,
}

#[derive(Debug, Clone)]
pub struct MethodInfo {
    pub name: String,
    pub doc: String,
    pub line: u32,
    pub is_static: bool,
    pub public: bool,
    pub params: Vec<Param>,
    pub return_hint: String,
    /// Every chain the body makes, in order, closures kept inside their arguments.
    pub chains: Vec<Chain>,
    /// What `return` statements hand back, as far as syntax says.
    pub returns: Vec<Val>,
}

#[derive(Debug, Clone)]
pub struct CaseInfo {
    pub name: String,
    pub value: Option<Val>,
    pub doc: String,
    pub deprecated: bool,
}

#[derive(Debug, Clone)]
pub struct ClassInfo {
    pub kind: ClassKind,
    pub name: String,
    pub fqn: String,
    pub is_abstract: bool,
    pub extends: Vec<String>,
    pub implements: Vec<String>,
    pub traits: Vec<String>,
    pub attributes: Vec<String>,
    pub doc: String,
    pub line: u32,
    pub consts: Vec<ConstInfo>,
    pub props: Vec<PropInfo>,
    pub methods: Vec<MethodInfo>,
    pub cases: Vec<CaseInfo>,
}

impl ClassInfo {
    pub fn method(&self, name: &str) -> Option<&MethodInfo> {
        self.methods.iter().find(|m| m.name == name)
    }
    pub fn prop(&self, name: &str) -> Option<&PropInfo> {
        self.props.iter().find(|p| p.name == name)
    }
    pub fn constructor(&self) -> Option<&MethodInfo> {
        self.method("__construct")
    }
    /// The class a property holds: a promoted constructor parameter or a typed
    /// property, which is how a Laravel class names what it depends on.
    pub fn prop_class(&self, name: &str) -> Option<&str> {
        if let Some(param) = self.constructor().and_then(|c| c.params.iter().find(|p| p.promoted && p.name == name)) {
            return param.class.as_deref();
        }
        self.prop(name).and_then(|p| p.class.as_deref())
    }
    pub fn deprecated(&self) -> bool {
        is_deprecated(&self.doc, &self.attributes)
    }
}

/// One parsed file.
#[derive(Debug, Clone)]
pub struct SourceFile {
    /// Absolute path.
    pub path: PathBuf,
    /// Which module's tree it was read from, an index the caller owns.
    pub module: usize,
    pub namespace: String,
    /// Local name → the full name a `use` line brought it in under.
    pub uses: BTreeMap<String, String>,
    pub classes: Vec<ClassInfo>,
    /// Chains made outside any class: what a route file is.
    pub chains: Vec<Chain>,
    pub parse_errors: usize,
}

impl SourceFile {
    /// Whether any resolved class name, hint or type in the file names `fqn`.
    pub fn has_segment(&self, segment: &str) -> bool {
        self.namespace.split('\\').any(|s| s == segment) || self.path.components().any(|c| c.as_os_str() == segment)
    }
}

/// Every file of every module, and the classes they declare by full name.
#[derive(Debug, Default)]
pub struct Tree {
    pub files: Vec<SourceFile>,
    index: BTreeMap<String, (usize, usize)>,
}

/// Directories no reader wants: dependencies, tests, assets, migrations.
const SKIP: &[&str] = &[
    "vendor",
    "node_modules",
    "tests",
    "Tests",
    "test",
    "storage",
    "public",
    "bootstrap",
    "resources",
    "Resources",
    "lang",
    "views",
    "Database",
    "database",
    ".git",
];

impl Tree {
    /// Reads every `.php` under each root, tagging files with the module index
    /// given beside it. Files are read in path order so that two runs agree.
    pub fn load(roots: &[(PathBuf, usize)]) -> Tree {
        let mut paths: Vec<(PathBuf, usize)> = Vec::new();
        for (root, module) in roots {
            let mut found = Vec::new();
            walk_dir(root, &mut found);
            found.sort();
            paths.extend(found.into_iter().map(|p| (p, *module)));
        }
        let mut tree = Tree::default();
        for (path, module) in paths {
            let Ok(text) = fs::read(&path) else { continue };
            let mut file = parse_bytes(&path, &text);
            file.module = module;
            tree.files.push(file);
        }
        tree.reindex();
        tree
    }

    /// One file from text, for tests and for a reader that wants a snippet.
    pub fn from_sources(sources: &[(&str, &str)]) -> Tree {
        let mut tree = Tree::default();
        for (name, text) in sources {
            tree.files.push(parse_bytes(Path::new(name), text.as_bytes()));
        }
        tree.reindex();
        tree
    }

    fn reindex(&mut self) {
        self.index.clear();
        for (fi, file) in self.files.iter().enumerate() {
            for (ci, class) in file.classes.iter().enumerate() {
                self.index.entry(class.fqn.clone()).or_insert((fi, ci));
            }
        }
    }

    pub fn class(&self, fqn: &str) -> Option<&ClassInfo> {
        let (fi, ci) = self.index.get(fqn.trim_start_matches('\\'))?;
        Some(&self.files[*fi].classes[*ci])
    }

    pub fn file_of(&self, fqn: &str) -> Option<&SourceFile> {
        let (fi, _) = self.index.get(fqn.trim_start_matches('\\'))?;
        Some(&self.files[*fi])
    }

    pub fn classes(&self) -> impl Iterator<Item = (&SourceFile, &ClassInfo)> {
        self.files.iter().flat_map(|f| f.classes.iter().map(move |c| (f, c)))
    }

    /// Whether `fqn` extends, directly or through parents in the tree, a class
    /// `pred` accepts - asked of every ancestor, in the tree or not.
    pub fn extends(&self, fqn: &str, pred: &dyn Fn(&str, bool) -> bool) -> bool {
        let mut seen = Vec::new();
        let mut queue = vec![fqn.to_string()];
        while let Some(name) = queue.pop() {
            if seen.contains(&name) || seen.len() > 32 {
                continue;
            }
            seen.push(name.clone());
            match self.class(&name) {
                Some(class) => {
                    for parent in &class.extends {
                        if pred(parent, self.class(parent).is_some()) {
                            return true;
                        }
                        queue.push(parent.clone());
                    }
                }
                None => {
                    if name != fqn && pred(&name, false) {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn walk_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !SKIP.contains(&name.as_str()) {
                walk_dir(&path, out);
            }
        } else if name.ends_with(".php") && !name.ends_with(".blade.php") {
            out.push(path);
        }
    }
}

pub fn parse_bytes(path: &Path, text: &[u8]) -> SourceFile {
    let name = path.to_string_lossy().to_string();
    let file = File::ephemeral(Cow::Owned(name.into_bytes()), Cow::Owned(text.to_vec()));
    let arena = LocalArena::new();
    let program = parse_file(&arena, &file);
    let mut reader = Reader {
        program,
        file: &file,
        out: SourceFile {
            path: path.to_path_buf(),
            module: 0,
            namespace: String::new(),
            uses: BTreeMap::new(),
            classes: Vec::new(),
            chains: Vec::new(),
            parse_errors: program.errors.len(),
        },
        sinks: vec![Vec::new()],
    };
    walk_program_mut(&mut reader, program, &mut ());
    let chains = reader.sinks.pop().unwrap_or_default();
    let mut out = reader.out;
    out.chains = chains;
    out
}

struct Reader<'ast, 'arena> {
    program: &'ast Program<'arena>,
    file: &'ast File,
    out: SourceFile,
    sinks: Vec<Vec<Chain>>,
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

impl<'ast, 'arena> Reader<'ast, 'arena> {
    fn line(&self, node: &impl HasSpan) -> u32 {
        self.file.line_number(node.span().start.offset) + 1
    }

    fn doc(&self, node: &impl HasSpan) -> String {
        get_docblock_before_position(self.program.trivia.as_slice(), node.span().start.offset)
            .map(|t| clean_doc(&text(t.value)))
            .unwrap_or_default()
    }

    fn push(&mut self, chain: Chain) {
        if let Some(sink) = self.sinks.last_mut() {
            sink.push(chain);
        }
    }

    /// `Foo`, `Bar\Foo`, `\Bar\Foo` → the full name, by the file's `use` lines
    /// and namespace, the way PHP itself would - without the global fallback
    /// for functions, which readers apply by comparing last segments.
    fn resolve(&self, id: &Identifier<'arena>) -> String {
        match id {
            Identifier::FullyQualified(f) => text(f.value).trim_start_matches('\\').to_string(),
            Identifier::Qualified(q) => {
                let name = text(q.value);
                let (first, rest) = name.split_once('\\').unwrap_or((&name, ""));
                match self.out.uses.get(first) {
                    Some(full) => format!("{full}\\{rest}"),
                    None => self.in_namespace(&name),
                }
            }
            Identifier::Local(l) => self.resolve_local(&text(l.value)),
        }
    }

    fn resolve_local(&self, name: &str) -> String {
        match name.to_ascii_lowercase().as_str() {
            "self" | "static" | "parent" => return name.to_ascii_lowercase(),
            _ => {}
        }
        match self.out.uses.get(name) {
            Some(full) => full.clone(),
            None => self.in_namespace(name),
        }
    }

    fn in_namespace(&self, name: &str) -> String {
        if self.out.namespace.is_empty() {
            name.to_string()
        } else {
            format!("{}\\{name}", self.out.namespace)
        }
    }

    fn hint(&self, hint: &Hint<'arena>) -> String {
        match hint {
            Hint::Identifier(id) => match id {
                Identifier::Local(l) => text(l.value),
                Identifier::Qualified(q) => text(q.value).rsplit('\\').next().unwrap_or_default().to_string(),
                Identifier::FullyQualified(f) => text(f.value).rsplit('\\').next().unwrap_or_default().to_string(),
            },
            Hint::Parenthesized(p) => format!("({})", self.hint(p.hint)),
            Hint::Nullable(n) => format!("?{}", self.hint(n.hint)),
            Hint::Union(u) => format!("{}|{}", self.hint(u.left), self.hint(u.right)),
            Hint::Intersection(i) => format!("{}&{}", self.hint(i.left), self.hint(i.right)),
            Hint::Null(k) | Hint::True(k) | Hint::False(k) | Hint::Array(k) | Hint::Callable(k) | Hint::Static(k) | Hint::Self_(k) | Hint::Parent(k) => {
                text(k.value)
            }
            Hint::Void(l)
            | Hint::Never(l)
            | Hint::Float(l)
            | Hint::Bool(l)
            | Hint::Integer(l)
            | Hint::String(l)
            | Hint::Object(l)
            | Hint::Mixed(l)
            | Hint::Iterable(l) => text(l.value),
        }
    }

    /// The class a hint names, when it names exactly one: `Foo`, `?Foo`.
    fn hint_class(&self, hint: &Hint<'arena>) -> Option<String> {
        match hint {
            Hint::Identifier(id) => {
                let full = self.resolve(id);
                let lower = full.to_ascii_lowercase();
                if BUILTIN_TYPES.contains(&lower.as_str()) { None } else { Some(full) }
            }
            Hint::Nullable(n) => self.hint_class(n.hint),
            Hint::Parenthesized(p) => self.hint_class(p.hint),
            _ => None,
        }
    }

    fn args(&mut self, list: &'ast ArgumentList<'arena>) -> Vec<Val> {
        list.arguments
            .iter()
            .map(|a| match a {
                Argument::Positional(p) => self.val(p.value),
                Argument::Named(n) => self.val(n.value),
            })
            .collect()
    }

    fn closure_body(&mut self, block: &'ast Block<'arena>) -> Vec<Chain> {
        self.sinks.push(Vec::new());
        walk_block_mut(self, block, &mut ());
        self.sinks.pop().unwrap_or_default()
    }

    /// What an expression is worth. A call anywhere inside a value the reader
    /// cannot shape is still harvested into the current sink, so that nothing
    /// dispatched inside an expression is lost.
    fn val(&mut self, expr: &'ast Expression<'arena>) -> Val {
        match expr {
            Expression::Literal(Literal::String(s)) => Val::Str(literal_string(s)),
            Expression::Literal(Literal::Integer(i)) => i.value.map(|v| Val::Int(v as i64)).unwrap_or(Val::Other),
            Expression::Literal(Literal::True(_)) => Val::Bool(true),
            Expression::Literal(Literal::False(_)) => Val::Bool(false),
            Expression::Literal(Literal::Null(_)) => Val::Null,
            Expression::Literal(Literal::Float(_)) => Val::Other,
            Expression::Parenthesized(p) => self.val(p.expression),
            Expression::ConstantAccess(c) => Val::Const(text(c.name.value())),
            Expression::Access(Access::ClassConstant(access)) => {
                let class = match access.class {
                    Expression::Identifier(id) => self.resolve(id),
                    Expression::Static(_) => "static".into(),
                    Expression::Self_(_) => "self".into(),
                    Expression::Parent(_) => "parent".into(),
                    other => {
                        walk_expression_mut(self, other, &mut ());
                        return Val::Other;
                    }
                };
                match &access.constant {
                    ClassLikeConstantSelector::Identifier(name) => {
                        let name = text(name.value);
                        if name.eq_ignore_ascii_case("class") {
                            Val::Class(class)
                        } else {
                            Val::ClassConst(class, name)
                        }
                    }
                    _ => Val::Other,
                }
            }
            Expression::Array(a) => self.array(a.elements.iter()),
            Expression::LegacyArray(a) => self.array(a.elements.iter()),
            Expression::Closure(c) => Val::Closure(self.closure_body(&c.body)),
            Expression::ArrowFunction(f) => {
                self.sinks.push(Vec::new());
                let value = self.val(f.expression);
                let mut chains = self.sinks.pop().unwrap_or_default();
                if let Val::Chain(chain) = value {
                    chains.push(*chain);
                }
                Val::Closure(chains)
            }
            Expression::Call(_) | Expression::Access(_) | Expression::Instantiation(_) => match self.chain(expr) {
                Some(chain) => Val::Chain(Box::new(chain)),
                None => {
                    walk_expression_mut(self, expr, &mut ());
                    Val::Other
                }
            },
            other => {
                walk_expression_mut(self, other, &mut ());
                Val::Other
            }
        }
    }

    fn array<I: Iterator<Item = &'ast ArrayElement<'arena>>>(&mut self, elements: I) -> Val {
        let mut items = Vec::new();
        for element in elements {
            match element {
                ArrayElement::KeyValue(kv) => {
                    let key = self.val(kv.key);
                    let value = self.val(kv.value);
                    items.push((Some(key), value));
                }
                ArrayElement::Value(v) => {
                    let value = self.val(v.value);
                    items.push((None, value));
                }
                ArrayElement::Variadic(v) => {
                    let value = self.val(v.value);
                    items.push((None, value));
                }
                ArrayElement::Missing(_) => {}
            }
        }
        Val::Arr(items)
    }

    /// The chain an expression is, when it is one: something with a receiver.
    fn chain(&mut self, expr: &'ast Expression<'arena>) -> Option<Chain> {
        let line = self.line(expr);
        match expr {
            Expression::Parenthesized(p) => self.chain(p.expression),
            Expression::Call(call) => match call {
                Call::Function(f) => {
                    let name = match f.function {
                        Expression::Identifier(id) => text(id.value()).trim_start_matches('\\').to_string(),
                        other => {
                            walk_expression_mut(self, other, &mut ());
                            return Some(Chain {
                                base: Base::Other,
                                parts: vec![Part {
                                    name: String::new(),
                                    args: Some(self.args(&f.argument_list)),
                                    line,
                                }],
                                line,
                            });
                        }
                    };
                    let args = self.args(&f.argument_list);
                    Some(Chain {
                        base: Base::Func(name, args),
                        parts: vec![],
                        line,
                    })
                }
                Call::Method(m) => {
                    let mut chain = self.receiver(m.object);
                    let name = self.selector(&m.method);
                    let args = self.args(&m.argument_list);
                    chain.parts.push(Part { name, args: Some(args), line });
                    Some(chain)
                }
                Call::NullSafeMethod(m) => {
                    let mut chain = self.receiver(m.object);
                    let name = self.selector(&m.method);
                    let args = self.args(&m.argument_list);
                    chain.parts.push(Part { name, args: Some(args), line });
                    Some(chain)
                }
                Call::StaticMethod(s) => {
                    let base = self.static_base(s.class);
                    let name = self.selector(&s.method);
                    let args = self.args(&s.argument_list);
                    Some(Chain {
                        base,
                        parts: vec![Part { name, args: Some(args), line }],
                        line,
                    })
                }
            },
            Expression::Access(access) => match access {
                Access::Property(p) => {
                    let mut chain = self.receiver(p.object);
                    let name = self.selector(&p.property);
                    chain.parts.push(Part { name, args: None, line });
                    Some(chain)
                }
                Access::NullSafeProperty(p) => {
                    let mut chain = self.receiver(p.object);
                    let name = self.selector(&p.property);
                    chain.parts.push(Part { name, args: None, line });
                    Some(chain)
                }
                Access::StaticProperty(p) => {
                    let base = self.static_base(p.class);
                    let name = match &p.property {
                        Variable::Direct(d) => text(d.name),
                        _ => String::new(),
                    };
                    Some(Chain {
                        base,
                        parts: vec![Part { name, args: None, line }],
                        line,
                    })
                }
                Access::ClassConstant(_) => None,
            },
            Expression::Instantiation(i) => {
                let class = match i.class {
                    Expression::Identifier(id) => self.resolve(id),
                    Expression::Static(_) => "static".into(),
                    Expression::Self_(_) => "self".into(),
                    Expression::Parent(_) => "parent".into(),
                    other => {
                        walk_expression_mut(self, other, &mut ());
                        String::new()
                    }
                };
                let args = i.argument_list.as_ref().map(|l| self.args(l)).unwrap_or_default();
                Some(Chain {
                    base: Base::New(class, args),
                    parts: vec![],
                    line,
                })
            }
            _ => None,
        }
    }

    fn static_base(&mut self, class: &'ast Expression<'arena>) -> Base {
        match class {
            Expression::Identifier(id) => Base::Static(self.resolve(id)),
            Expression::Static(_) => Base::Static("static".into()),
            Expression::Self_(_) => Base::Static("self".into()),
            Expression::Parent(_) => Base::Static("parent".into()),
            Expression::Variable(Variable::Direct(d)) => Base::Var(text(d.name).trim_start_matches('$').to_string()),
            other => {
                walk_expression_mut(self, other, &mut ());
                Base::Other
            }
        }
    }

    /// The chain an object expression continues: a chain of its own, a
    /// variable, or something the reader harvests and names `Other`.
    fn receiver(&mut self, object: &'ast Expression<'arena>) -> Chain {
        let line = self.line(object);
        if let Some(chain) = self.chain(object) {
            return chain;
        }
        match object {
            Expression::Variable(Variable::Direct(d)) => Chain {
                base: Base::Var(text(d.name).trim_start_matches('$').to_string()),
                parts: vec![],
                line,
            },
            Expression::Static(_) => Chain {
                base: Base::Static("static".into()),
                parts: vec![],
                line,
            },
            Expression::Self_(_) => Chain {
                base: Base::Static("self".into()),
                parts: vec![],
                line,
            },
            Expression::Parent(_) => Chain {
                base: Base::Static("parent".into()),
                parts: vec![],
                line,
            },
            other => {
                walk_expression_mut(self, other, &mut ());
                Chain {
                    base: Base::Other,
                    parts: vec![],
                    line,
                }
            }
        }
    }

    fn selector(&mut self, selector: &'ast ClassLikeMemberSelector<'arena>) -> String {
        match selector {
            ClassLikeMemberSelector::Identifier(id) => text(id.value),
            ClassLikeMemberSelector::Variable(Variable::Direct(d)) => text(d.name),
            ClassLikeMemberSelector::Expression(e) => {
                walk_expression_mut(self, e.expression, &mut ());
                String::new()
            }
            _ => String::new(),
        }
    }

    fn attributes(&self, lists: &Sequence<'arena, AttributeList<'arena>>) -> Vec<String> {
        lists.iter().flat_map(|l| l.attributes.iter().map(|a| self.resolve(&a.name))).collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn class_like(
        &mut self,
        kind: ClassKind,
        name: &LocalIdentifier<'arena>,
        attribute_lists: &Sequence<'arena, AttributeList<'arena>>,
        modifiers: Option<&Sequence<'arena, Modifier<'arena>>>,
        extends: Option<&Extends<'arena>>,
        implements: Option<&Implements<'arena>>,
        members: &'ast Sequence<'arena, ClassLikeMember<'arena>>,
        node: &impl HasSpan,
    ) {
        let name = text(name.value);
        let mut class = ClassInfo {
            kind,
            fqn: self.in_namespace(&name),
            name,
            is_abstract: modifiers.is_some_and(|m| m.iter().any(|m| matches!(m, Modifier::Abstract(_)))),
            extends: extends.map(|e| e.types.iter().map(|t| self.resolve(t)).collect()).unwrap_or_default(),
            implements: implements.map(|i| i.types.iter().map(|t| self.resolve(t)).collect()).unwrap_or_default(),
            traits: vec![],
            attributes: self.attributes(attribute_lists),
            doc: self.doc(node),
            line: self.line(node),
            consts: vec![],
            props: vec![],
            methods: vec![],
            cases: vec![],
        };
        for member in members.iter() {
            match member {
                ClassLikeMember::TraitUse(t) => class.traits.extend(t.trait_names.iter().map(|n| self.resolve(n))),
                ClassLikeMember::Constant(c) => {
                    let doc = self.doc(c);
                    let attrs = self.attributes(&c.attribute_lists);
                    let deprecated = is_deprecated(&doc, &attrs);
                    for item in c.items.iter() {
                        self.sinks.push(Vec::new());
                        let value = self.val(item.value);
                        self.sinks.pop();
                        class.consts.push(ConstInfo {
                            name: text(item.name.value),
                            value,
                            doc: doc.clone(),
                            deprecated,
                        });
                    }
                }
                ClassLikeMember::Property(p) => match p {
                    Property::Plain(plain) => {
                        let doc = self.doc(plain);
                        let hint = plain.hint.as_ref().map(|h| self.hint(h)).unwrap_or_default();
                        let hint_class = plain.hint.as_ref().and_then(|h| self.hint_class(h));
                        let is_static = plain.modifiers.iter().any(|m| matches!(m, Modifier::Static(_)));
                        let public = !plain.modifiers.iter().any(|m| matches!(m, Modifier::Protected(_) | Modifier::Private(_)));
                        for item in plain.items.iter() {
                            let (variable, value) = match item {
                                PropertyItem::Abstract(a) => (&a.variable, None),
                                PropertyItem::Concrete(c) => {
                                    self.sinks.push(Vec::new());
                                    let v = self.val(c.value);
                                    self.sinks.pop();
                                    (&c.variable, Some(v))
                                }
                            };
                            class.props.push(PropInfo {
                                name: text(variable.name).trim_start_matches('$').to_string(),
                                hint: hint.clone(),
                                class: hint_class.clone(),
                                value,
                                doc: doc.clone(),
                                is_static,
                                public,
                            });
                        }
                    }
                    Property::Hooked(hooked) => {
                        let doc = self.doc(hooked);
                        let hint = hooked.hint.as_ref().map(|h| self.hint(h)).unwrap_or_default();
                        let hint_class = hooked.hint.as_ref().and_then(|h| self.hint_class(h));
                        let variable = match &hooked.item {
                            PropertyItem::Abstract(a) => &a.variable,
                            PropertyItem::Concrete(c) => &c.variable,
                        };
                        let public = !hooked.modifiers.iter().any(|m| matches!(m, Modifier::Protected(_) | Modifier::Private(_)));
                        class.props.push(PropInfo {
                            name: text(variable.name).trim_start_matches('$').to_string(),
                            hint,
                            class: hint_class,
                            value: None,
                            doc,
                            is_static: false,
                            public,
                        });
                    }
                },
                ClassLikeMember::EnumCase(c) => {
                    let doc = self.doc(c);
                    let attrs = self.attributes(&c.attribute_lists);
                    let deprecated = is_deprecated(&doc, &attrs);
                    let (name, value) = match &c.item {
                        EnumCaseItem::Unit(u) => (text(u.name.value), None),
                        EnumCaseItem::Backed(b) => {
                            self.sinks.push(Vec::new());
                            let v = self.val(b.value);
                            self.sinks.pop();
                            (text(b.name.value), Some(v))
                        }
                    };
                    class.cases.push(CaseInfo { name, value, doc, deprecated });
                }
                ClassLikeMember::Method(m) => {
                    let method = self.method(m);
                    class.methods.push(method);
                }
            }
        }
        self.out.classes.push(class);
    }

    fn method(&mut self, m: &'ast Method<'arena>) -> MethodInfo {
        let params = m
            .parameter_list
            .parameters
            .iter()
            .map(|p| Param {
                name: text(p.variable.name).trim_start_matches('$').to_string(),
                hint: p.hint.as_ref().map(|h| self.hint(h)).unwrap_or_default(),
                class: p.hint.as_ref().and_then(|h| self.hint_class(h)),
                promoted: p
                    .modifiers
                    .iter()
                    .any(|m| matches!(m, Modifier::Public(_) | Modifier::Protected(_) | Modifier::Private(_) | Modifier::Readonly(_))),
            })
            .collect();
        let mut returns = Vec::new();
        let chains = match &m.body {
            MethodBody::Concrete(block) => {
                self.sinks.push(Vec::new());
                walk_block_mut(self, block, &mut ());
                let chains = self.sinks.pop().unwrap_or_default();
                collect_returns(self, block, &mut returns);
                chains
            }
            MethodBody::Abstract(_) => vec![],
        };
        MethodInfo {
            name: text(m.name.value),
            doc: self.doc(m),
            line: self.line(m),
            is_static: m.modifiers.iter().any(|x| matches!(x, Modifier::Static(_))),
            public: !m.modifiers.iter().any(|x| matches!(x, Modifier::Protected(_) | Modifier::Private(_))),
            params,
            return_hint: m.return_type_hint.as_ref().map(|r| self.hint(&r.hint)).unwrap_or_default(),
            chains,
            returns,
        }
    }
}

/// The values a block's own `return` statements hand back - not those of
/// closures inside it, which return to somebody else.
fn collect_returns<'ast, 'arena>(reader: &mut Reader<'ast, 'arena>, block: &'ast Block<'arena>, out: &mut Vec<Val>) {
    for statement in block.statements.iter() {
        returns_of(reader, statement, out);
    }
}

fn returns_of<'ast, 'arena>(reader: &mut Reader<'ast, 'arena>, statement: &'ast Statement<'arena>, out: &mut Vec<Val>) {
    match statement {
        Statement::Return(r) => {
            if let Some(value) = r.value {
                reader.sinks.push(Vec::new());
                let v = reader.val(value);
                reader.sinks.pop();
                out.push(v);
            }
        }
        Statement::Block(b) => collect_returns(reader, b, out),
        Statement::If(i) => {
            if let IfBody::Statement(body) = &i.body {
                returns_of(reader, body.statement, out);
                for clause in body.else_if_clauses.iter() {
                    returns_of(reader, clause.statement, out);
                }
                if let Some(clause) = &body.else_clause {
                    returns_of(reader, clause.statement, out);
                }
            }
        }
        Statement::Try(t) => {
            collect_returns(reader, &t.block, out);
            for c in t.catch_clauses.iter() {
                collect_returns(reader, &c.block, out);
            }
        }
        _ => {}
    }
}

impl<'ast, 'arena> MutWalker<'ast, 'arena, ()> for Reader<'ast, 'arena> {
    fn walk_namespace(&mut self, namespace: &'ast Namespace<'arena>, context: &mut ()) {
        self.out.namespace = namespace
            .name
            .as_ref()
            .map(|n| text(n.value()).trim_start_matches('\\').to_string())
            .unwrap_or_default();
        walk_namespace_mut(self, namespace, context);
    }

    fn walk_use(&mut self, r#use: &'ast Use<'arena>, _context: &mut ()) {
        let mut add = |item: &UseItem<'arena>, prefix: &str| {
            let full = text(item.name.value()).trim_start_matches('\\').to_string();
            let full = if prefix.is_empty() { full } else { format!("{prefix}\\{full}") };
            let alias = match &item.alias {
                Some(a) => text(a.identifier.value),
                None => full.rsplit('\\').next().unwrap_or_default().to_string(),
            };
            self.out.uses.insert(alias, full);
        };
        match &r#use.items {
            UseItems::Sequence(seq) => {
                for item in seq.items.iter() {
                    add(item, "");
                }
            }
            UseItems::TypedSequence(_) | UseItems::TypedList(_) => {}
            UseItems::MixedList(list) => {
                let prefix = text(list.namespace.value()).trim_start_matches('\\').trim_end_matches('\\').to_string();
                for item in list.items.iter() {
                    if item.r#type.is_none() {
                        add(&item.item, &prefix);
                    }
                }
            }
        }
    }

    fn walk_class(&mut self, class: &'ast Class<'arena>, _context: &mut ()) {
        self.class_like(
            ClassKind::Class,
            &class.name,
            &class.attribute_lists,
            Some(&class.modifiers),
            class.extends.as_ref(),
            class.implements.as_ref(),
            &class.members,
            class,
        );
    }

    fn walk_interface(&mut self, interface: &'ast Interface<'arena>, _context: &mut ()) {
        self.class_like(
            ClassKind::Interface,
            &interface.name,
            &interface.attribute_lists,
            None,
            interface.extends.as_ref(),
            None,
            &interface.members,
            interface,
        );
    }

    fn walk_trait(&mut self, r#trait: &'ast Trait<'arena>, _context: &mut ()) {
        self.class_like(
            ClassKind::Trait,
            &r#trait.name,
            &r#trait.attribute_lists,
            None,
            None,
            None,
            &r#trait.members,
            r#trait,
        );
    }

    fn walk_enum(&mut self, r#enum: &'ast Enum<'arena>, _context: &mut ()) {
        self.class_like(
            ClassKind::Enum,
            &r#enum.name,
            &r#enum.attribute_lists,
            None,
            None,
            r#enum.implements.as_ref(),
            &r#enum.members,
            r#enum,
        );
    }

    fn walk_expression(&mut self, expression: &'ast Expression<'arena>, context: &mut ()) {
        match self.chain(expression) {
            Some(chain) => self.push(chain),
            None => walk_expression_mut(self, expression, context),
        }
    }
}

const BUILTIN_TYPES: &[&str] = &[
    "int", "float", "string", "bool", "array", "mixed", "void", "null", "callable", "iterable", "object", "self", "static", "parent", "never", "true", "false",
];

fn literal_string(s: &LiteralString<'_>) -> String {
    match s.value {
        Some(v) => text(v),
        None => {
            let raw = text(s.raw);
            raw.trim_matches(|c| c == '\'' || c == '"').to_string()
        }
    }
}

/// `/** ... */` → its lines, the frame and the leading stars gone.
pub fn clean_doc(raw: &str) -> String {
    let inner = raw.trim().trim_start_matches("/**").trim_end_matches("*/");
    let lines: Vec<String> = inner
        .lines()
        .map(|l| {
            let l = l.trim();
            let l = l.strip_prefix('*').unwrap_or(l);
            l.trim().to_string()
        })
        .collect();
    let start = lines.iter().position(|l| !l.is_empty()).unwrap_or(lines.len());
    let end = lines.iter().rposition(|l| !l.is_empty()).map(|i| i + 1).unwrap_or(start);
    lines[start..end].join("\n")
}

/// The first paragraph of a cleaned docblock, tags set aside: what a page
/// shows beside the name.
pub fn summary(doc: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for line in doc.lines() {
        if line.is_empty() {
            if !out.is_empty() {
                break;
            }
            continue;
        }
        if line.starts_with('@') {
            if out.is_empty() {
                continue;
            }
            break;
        }
        out.push(line);
    }
    out.join(" ")
}

pub fn is_deprecated(doc: &str, attributes: &[String]) -> bool {
    doc.lines().any(|l| l.starts_with("@deprecated")) || attributes.iter().any(|a| a == "Deprecated" || a.ends_with("\\Deprecated"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(src: &str) -> SourceFile {
        parse_bytes(Path::new("a.php"), src.as_bytes())
    }

    #[test]
    fn reads_a_class_with_its_names_resolved() {
        let file = one(
            "<?php\nnamespace Acme\\Sales\\Models;\nuse Illuminate\\Database\\Eloquent\\Model;\nuse Acme\\Sales\\Contracts\\Order as OrderContract;\n/**\n * An order.\n *\n * @property int $id\n */\nclass Order extends Model implements OrderContract {\n    use HasFactory;\n    /** Pending. */\n    public const STATUS_PENDING = 'pending';\n    protected $fillable = ['status', 'total'];\n    protected $casts = ['total' => 'float'];\n    public function items(): HasMany { return $this->hasMany(OrderItem::class, 'order_id'); }\n}\n",
        );
        assert_eq!(file.namespace, "Acme\\Sales\\Models");
        assert_eq!(file.parse_errors, 0);
        let class = &file.classes[0];
        assert_eq!(class.fqn, "Acme\\Sales\\Models\\Order");
        assert_eq!(class.extends, vec!["Illuminate\\Database\\Eloquent\\Model"]);
        assert_eq!(class.implements, vec!["Acme\\Sales\\Contracts\\Order"]);
        assert_eq!(class.traits, vec!["Acme\\Sales\\Models\\HasFactory"]);
        assert_eq!(summary(&class.doc), "An order.");
        assert_eq!(class.consts[0].name, "STATUS_PENDING");
        assert_eq!(class.consts[0].value, Val::Str("pending".into()));
        assert_eq!(summary(&class.consts[0].doc), "Pending.");
        assert_eq!(
            class.prop("fillable").unwrap().value,
            Some(Val::Arr(vec![(None, Val::Str("status".into())), (None, Val::Str("total".into()))]))
        );
        assert_eq!(
            class.prop("casts").unwrap().value.as_ref().unwrap().get("total"),
            Some(&Val::Str("float".into()))
        );
        let items = class.method("items").unwrap();
        assert_eq!(items.return_hint, "HasMany");
        let chain = &items.chains[0];
        assert_eq!(chain.base, Base::Var("this".into()));
        assert_eq!(chain.parts[0].name, "hasMany");
        assert_eq!(chain.parts[0].args.as_ref().unwrap()[0], Val::Class("Acme\\Sales\\Models\\OrderItem".into()));
        assert_eq!(items.returns.len(), 1);
    }

    #[test]
    fn reads_route_chains_with_their_closures() {
        let file = one(
            "<?php\nuse Illuminate\\Support\\Facades\\Route;\nuse Acme\\Shop\\Http\\Controllers\\CartController;\n\nRoute::controller(CartController::class)->prefix('checkout/cart')->group(function () {\n    Route::get('', 'index')->name('shop.checkout.cart.index');\n    Route::post('add/{id}', 'store')->name('shop.checkout.cart.store');\n});\n",
        );
        assert_eq!(file.chains.len(), 1);
        let outer = &file.chains[0];
        assert_eq!(outer.base, Base::Static("Illuminate\\Support\\Facades\\Route".into()));
        assert_eq!(
            outer.parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            ["controller", "prefix", "group"]
        );
        let Some(Val::Closure(inner)) = outer.parts[2].args.as_ref().and_then(|a| a.first()) else {
            panic!("group takes a closure")
        };
        assert_eq!(inner.len(), 2);
        assert_eq!(inner[0].parts[0].name, "get");
        assert_eq!(inner[0].parts[1].name, "name");
        assert_eq!(inner[1].line, 7);
    }

    #[test]
    fn harvests_calls_nested_in_values_it_cannot_shape() {
        let file = one("<?php\nclass A { function f($x) { $y = $x ?: Event::dispatch('a.b', [$x]); return foo(1 + bar()); } }\n");
        let method = &file.classes[0].methods[0];
        let mut all = Vec::new();
        for chain in &method.chains {
            chain.flatten(&mut all);
        }
        let names: Vec<String> = all
            .iter()
            .map(|c| match &c.base {
                Base::Static(s) => format!("{s}::{}", c.parts[0].name),
                Base::Func(f, _) => f.clone(),
                _ => "?".into(),
            })
            .collect();
        // A call harvested out of an argument the reader could not shape
        // lands before the call it was an argument of; nothing is lost.
        assert_eq!(names, ["Event::dispatch", "bar", "foo"]);
    }

    #[test]
    fn keeps_reading_past_a_syntax_error() {
        let file = one("<?php\nclass A { function f() { $x = ; } }\nclass B {}\n");
        assert!(file.parse_errors > 0);
        assert_eq!(file.classes.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["A", "B"]);
    }

    #[test]
    fn cleans_docblocks() {
        assert_eq!(
            clean_doc("/**\n     * Handle the event.\n     *\n     * @param  string  $x\n     */"),
            "Handle the event.\n\n@param  string  $x"
        );
        assert_eq!(summary("Handle the event.\n\n@param  string  $x"), "Handle the event.");
        assert_eq!(summary("First line\nsecond line.\n\nMore."), "First line second line.");
        assert!(is_deprecated("Old.\n\n@deprecated use B", &[]));
    }
}
