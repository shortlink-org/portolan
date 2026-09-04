package org.portolan.extract;

import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.ModifiersTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.Trees;

import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * The tree, read as syntax.
 *
 * The parser is javac's own - {@code JavacTask.parse}, and nothing past it. No
 * classpath is assembled and no symbol is resolved, which is deliberate twice
 * over: the service's dependencies are not this plugin's to fetch, and every
 * other extractor in this repository resolves by name and by file too. What is
 * read is what the author wrote.
 */
final class Source {

    /** Directories that hold no claim about the model. */
    private static final List<String> SKIP = List.of("target", "build", "out", "generated", ".git", "node_modules");

    /** One compilation unit, and what can be asked of it. */
    static final class Unit {
        final Path path;
        final String rel;
        final String packageName;
        final CompilationUnitTree tree;
        /** simple name -> fully qualified, for every single-type import. */
        final Map<String, String> imports = new LinkedHashMap<>();
        private final Trees trees;
        private final SourcePositions positions;

        Unit(Path path, String rel, CompilationUnitTree tree, Trees trees) {
            this.path = path;
            this.rel = rel;
            this.tree = tree;
            this.trees = trees;
            this.positions = trees.getSourcePositions();
            this.packageName = tree.getPackageName() == null ? "" : tree.getPackageName().toString();
            for (ImportTree imported : tree.getImports()) {
                String qualified = imported.getQualifiedIdentifier().toString();
                int cut = qualified.lastIndexOf('.');
                imports.put(cut < 0 ? qualified : qualified.substring(cut + 1), qualified);
            }
        }

        /** The classes, records, interfaces and enums this file declares. */
        List<ClassTree> classes() {
            List<ClassTree> out = new ArrayList<>();
            for (Tree member : tree.getTypeDecls()) {
                if (member instanceof ClassTree declared) {
                    out.add(declared);
                }
            }
            return out;
        }

        String where(Tree node) {
            long start = positions.getStartPosition(tree, node);
            if (start < 0) {
                return rel;
            }
            return rel + ":" + tree.getLineMap().getLineNumber(start);
        }

        /** The javadoc above a declaration, first paragraph only. */
        String doc(Tree node) {
            TreePath path = TreePath.getPath(tree, node);
            String comment = path == null ? null : trees.getDocComment(path);
            if (comment == null) {
                return "";
            }
            String text = comment.strip();
            int cut = text.indexOf("\n\n");
            if (cut > 0) {
                text = text.substring(0, cut);
            }
            int tag = text.indexOf("\n@");
            if (tag > 0) {
                text = text.substring(0, tag);
            }
            return text.replaceAll("\\s*\n\\s*", " ").strip();
        }

        /** What an imported name refers to, or the name itself when nothing imports it. */
        String resolve(String simple) {
            return imports.getOrDefault(simple, packageName.isEmpty() ? simple : packageName + "." + simple);
        }
    }

    /** Every unit under the source root, parsed once. */
    static final class Project {
        final List<Unit> units = new ArrayList<>();
        final List<String[]> broken = new ArrayList<>();
        /** simple class name -> the unit that declares it. */
        final Map<String, Unit> unitOf = new LinkedHashMap<>();
        final Map<String, ClassTree> classOf = new LinkedHashMap<>();

        Unit unit(String simpleName) {
            return unitOf.get(simpleName);
        }

        ClassTree type(String simpleName) {
            return classOf.get(simpleName);
        }
    }

    private Source() {}

    static Project parse(Path root, java.util.function.Function<Path, String> rel) throws IOException {
        Project project = new Project();
        List<Path> files = files(root);
        if (files.isEmpty()) {
            return project;
        }

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("no java compiler: extract-java needs a JDK, not a JRE");
        }
        List<String> problems = new ArrayList<>();
        StandardJavaFileManager manager = compiler.getStandardFileManager(
                diagnostic -> problems.add(diagnostic.getSource() + ": " + diagnostic.getMessage(null)),
                null,
                StandardCharsets.UTF_8);
        Iterable<? extends JavaFileObject> objects = manager.getJavaFileObjectsFromPaths(files);
        // -proc:none because annotation processors would need the service's own
        // dependencies on the classpath, and this reads source rather than
        // building anything.
        JavacTask task = (JavacTask) compiler.getTask(Writer.nullWriter(), manager, diagnostic -> {}, List.of("-proc:none"), null, objects);

        Trees trees = Trees.instance(task);
        for (CompilationUnitTree tree : task.parse()) {
            Path path = Path.of(tree.getSourceFile().toUri());
            Unit unit = new Unit(path, rel.apply(path), tree, trees);
            project.units.add(unit);
            for (ClassTree declared : unit.classes()) {
                project.unitOf.putIfAbsent(declared.getSimpleName().toString(), unit);
                project.classOf.putIfAbsent(declared.getSimpleName().toString(), declared);
            }
        }
        for (String problem : problems) {
            project.broken.add(new String[] {problem, "cannot be parsed, so nothing in it is read"});
        }
        manager.close();

        return project;
    }

    /** Every .java file under a directory, in a stable order. */
    static List<Path> files(Path root) throws IOException {
        if (!Files.isDirectory(root)) {
            return List.of();
        }
        try (Stream<Path> walk = Files.walk(root)) {
            return walk.filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> {
                        for (Path part : p) {
                            if (SKIP.contains(part.toString())) {
                                return false;
                            }
                        }
                        return true;
                    })
                    .sorted()
                    .toList();
        }
    }

    // --- reading declarations ------------------------------------------------

    /** The simple names of the annotations on a declaration. */
    static List<String> annotationNames(ModifiersTree modifiers) {
        List<String> out = new ArrayList<>();
        for (AnnotationTree annotation : modifiers.getAnnotations()) {
            out.add(simple(annotation.getAnnotationType().toString()));
        }
        return out;
    }

    static boolean annotated(ModifiersTree modifiers, String... names) {
        List<String> found = annotationNames(modifiers);
        for (String name : names) {
            if (found.contains(name)) {
                return true;
            }
        }
        return false;
    }

    static Optional<AnnotationTree> annotation(ModifiersTree modifiers, String name) {
        for (AnnotationTree annotation : modifiers.getAnnotations()) {
            if (simple(annotation.getAnnotationType().toString()).equals(name)) {
                return Optional.of(annotation);
            }
        }
        return Optional.empty();
    }

    /** An annotation's argument, by name; `value` is also the bare one. */
    static String argument(AnnotationTree annotation, String name) {
        for (ExpressionTree argument : annotation.getArguments()) {
            String text = argument.toString();
            int eq = text.indexOf('=');
            if (eq < 0) {
                if (name.equals("value")) {
                    return literal(text);
                }
                continue;
            }
            if (text.substring(0, eq).strip().equals(name)) {
                return literal(text.substring(eq + 1));
            }
        }
        return "";
    }

    /** The string a literal expression holds, or "" for anything else. */
    static String literal(String text) {
        String trimmed = text.strip();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return "";
    }

    static String simple(String name) {
        int cut = name.lastIndexOf('.');
        String last = cut < 0 ? name : name.substring(cut + 1);
        int generic = last.indexOf('<');
        return generic < 0 ? last : last.substring(0, generic);
    }

    static List<MethodTree> methods(ClassTree type) {
        List<MethodTree> out = new ArrayList<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof MethodTree method && !method.getName().contentEquals("<init>")) {
                out.add(method);
            }
        }
        return out;
    }

    static Optional<MethodTree> method(ClassTree type, String name) {
        return methods(type).stream().filter(m -> m.getName().contentEquals(name)).findFirst();
    }

    /** The fields a class declares, and a record's components, in order. */
    static List<VariableTree> fields(ClassTree type) {
        List<VariableTree> out = new ArrayList<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof VariableTree field && !field.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)) {
                out.add(field);
            }
        }
        return out;
    }

    static List<VariableTree> constants(ClassTree type) {
        List<VariableTree> out = new ArrayList<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof VariableTree field && field.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)) {
                out.add(field);
            }
        }
        return out;
    }

    static List<ClassTree> nested(ClassTree type) {
        List<ClassTree> out = new ArrayList<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof ClassTree inner) {
                out.add(inner);
            }
        }
        return out;
    }

    static boolean isRecord(ClassTree type) {
        return type.getKind() == Tree.Kind.RECORD;
    }

    static boolean isEnum(ClassTree type) {
        return type.getKind() == Tree.Kind.ENUM;
    }

    static boolean isInterface(ClassTree type) {
        return type.getKind() == Tree.Kind.INTERFACE;
    }

    /** The supertypes a class names, by simple name. */
    static List<String> supertypes(ClassTree type) {
        List<String> out = new ArrayList<>();
        if (type.getExtendsClause() != null) {
            out.add(simple(type.getExtendsClause().toString()));
        }
        for (Tree implemented : type.getImplementsClause()) {
            out.add(simple(implemented.toString()));
        }
        return out;
    }
}
