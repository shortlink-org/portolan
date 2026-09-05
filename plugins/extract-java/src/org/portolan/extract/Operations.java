package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreeScanner;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import javax.lang.model.element.Modifier;

/**
 * What somebody can ask the service to do.
 *
 * A class saying {@code @Service} - jMolecules' one, the one that means "a
 * piece of the model that is not an aggregate" - is a use case, and so is a
 * class under {@code application/**\/usecase} for a project that does not use
 * the annotations. Its entry is {@code handle}, or the single public method it
 * has if it calls that something else.
 */
final class Operations {

    static final class UseCase {
        final String id;            // AuthorizePayment
        final ClassTree type;
        final MethodTree entry;
        final Source.Unit unit;
        final String aggregate;     // the domain package's last segment, when the layout says
        final String doc;
        final String kind;

        UseCase(String id, ClassTree type, MethodTree entry, Source.Unit unit, String aggregate, String doc, String kind) {
            this.id = id;
            this.type = type;
            this.entry = entry;
            this.unit = unit;
            this.aggregate = aggregate;
            this.doc = doc;
            this.kind = kind;
        }
    }

    /** The same core port-write vocabulary used by the Go, TS and Rust extractors. */
    static final List<String> WRITE_METHODS = List.of("save", "delete", "create", "update", "publish", "remove", "insert", "upsert");

    private Operations() {}

    static List<UseCase> read(Source.Project project, Protocol.Builder b) {
        List<UseCase> out = new ArrayList<>();
        for (Source.Unit unit : project.units) {
            boolean byLayout = unit.packageName.contains(".application.") && unit.packageName.endsWith(".usecase");
            for (ClassTree type : unit.classes()) {
                boolean declared = Source.annotated(type.getModifiers(), "Service", "UseCase");
                if (!declared && !byLayout) {
                    continue;
                }
                if (Source.isInterface(type)) {
                    continue;
                }
                MethodTree entry = entry(type);
                if (entry == null) {
                    b.warn(unit.rel, type.getSimpleName() + " is a use case with no public method to run: nothing can reach it");
                    continue;
                }
                if (!declared) {
                    b.warn(unit.rel, type.getSimpleName() + " is read as a use case because of where it sits; @Service would say so outright");
                }
                out.add(new UseCase(
                        type.getSimpleName().toString(),
                        type,
                        entry,
                        unit,
                        aggregateOf(unit.packageName),
                        unit.doc(type),
                        writes(type) ? "command" : "query"));
            }
        }
        out.sort(Comparator.comparing(u -> u.id));
        return out;
    }

    /** `handle`, or the one public method there is. */
    private static MethodTree entry(ClassTree type) {
        List<MethodTree> methods = new ArrayList<>();
        for (MethodTree method : Source.methods(type)) {
            if (method.getModifiers().getFlags().contains(Modifier.PUBLIC)) {
                methods.add(method);
            }
        }
        for (MethodTree method : methods) {
            if (method.getName().contentEquals("handle") || method.getName().contentEquals("execute")) {
                return method;
            }
        }
        return methods.size() == 1 ? methods.get(0) : null;
    }

    /** `…application.payment.usecase` -> payment. */
    static String aggregateOf(String pkg) {
        int at = pkg.indexOf(".application.");
        if (at < 0) {
            return "";
        }
        String rest = pkg.substring(at + ".application.".length());
        int cut = rest.indexOf('.');
        return cut < 0 ? rest : rest.substring(0, cut);
    }

    private static boolean writes(ClassTree type) {
        boolean[] found = {false};
        Set<String> ports = new HashSet<>();
        for (VariableTree port : ports(type)) {
            ports.add(port.getName().toString());
        }
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitMethodInvocation(MethodInvocationTree node, Void ignored) {
                if (node.getMethodSelect() instanceof MemberSelectTree method) {
                    String name = method.getIdentifier().toString().toLowerCase(Locale.ROOT);
                    String receiver = method.getExpression().toString();
                    if (receiver.startsWith("this.")) {
                        receiver = receiver.substring("this.".length());
                    }
                    if (WRITE_METHODS.contains(name) && ports.contains(receiver)) {
                        found[0] = true;
                    }
                }
                return super.visitMethodInvocation(node, ignored);
            }

            @Override
            public Void visitNewClass(NewClassTree node, Void ignored) {
                return super.visitNewClass(node, ignored);
            }
        }.scan(type, null);
        return found[0];
    }

    /** The constructor parameters a use case holds: its ports, by name and type. */
    static List<VariableTree> ports(ClassTree type) {
        for (var member : type.getMembers()) {
            if (member instanceof MethodTree method && method.getName().contentEquals("<init>")) {
                return new ArrayList<>(method.getParameters());
            }
        }
        return List.of();
    }
}
