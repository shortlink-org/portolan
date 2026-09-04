package org.portolan.extract;

import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreeScanner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The root's states, read off the table the code keeps.
 *
 * Never off the branches of the methods: the table is the claim and the methods
 * are held to it. In Java the table is a {@code TRANSITIONS} map beside the
 * status enum, and the mover is the method assigning {@code this.status}. An
 * edge nothing makes, a move into a state the table lacks, and a status
 * assigned outside a mover are each reported.
 */
final class Lifecycle {

    private record Move(String to, String on, String emits, String source) {}

    private Lifecycle() {}

    static Map<String, Object> read(Domain.Aggregate aggregate, Map<String, Events.Found> events, Protocol.Builder b) {
        ClassTree statuses = statusEnum(aggregate);
        if (statuses == null) {
            return null;
        }
        Map<String, List<String>> table = table(statuses);
        List<String> states = new ArrayList<>(constants(statuses));
        if (table.isEmpty()) {
            b.warn(aggregate.id(), statuses.getSimpleName() + " names the states but declares no TRANSITIONS: the table is the claim, and the methods are held to it");
            return null;
        }

        List<Move> moves = new ArrayList<>();
        List<String> loose = new ArrayList<>();
        Source.Unit unit = aggregate.rootUnit;
        for (MethodTree method : Source.methods(aggregate.root)) {
            String emits = emits(method, events);
            new TreeScanner<Void, Void>() {
                @Override
                public Void visitAssignment(AssignmentTree node, Void ignored) {
                    String target = node.getVariable().toString();
                    if (target.equals("this.status") || target.equals("status")) {
                        String to = state(node.getExpression());
                        if (to.isEmpty()) {
                            loose.add(method.getName() + " (" + unit.where(node) + ")");
                        } else {
                            moves.add(new Move(to, method.getName().toString(), emits, unit.where(node)));
                        }
                    }
                    return super.visitAssignment(node, ignored);
                }
            }.scan(method, null);
        }

        for (Move move : moves) {
            if (!states.contains(move.to())) {
                states.add(move.to());
                b.warn(aggregate.id(), move.on() + " moves to " + move.to() + ", which the states do not name");
            }
        }

        List<Object> transitions = new ArrayList<>();
        Set<String> made = new LinkedHashSet<>();
        for (Move move : moves) {
            for (Map.Entry<String, List<String>> entry : table.entrySet()) {
                if (!entry.getValue().contains(move.to())) {
                    continue;
                }
                transitions.add(Catalog.transition(entry.getKey(), move.to(), move.on(), move.emits(), move.source()));
                made.add(entry.getKey() + "->" + move.to());
            }
        }
        for (Map.Entry<String, List<String>> entry : table.entrySet()) {
            for (String to : entry.getValue()) {
                if (!made.contains(entry.getKey() + "->" + to)) {
                    b.warn(aggregate.id(), "the table has " + entry.getKey() + " -> " + to + " and no method of " + aggregate.root.getSimpleName() + " makes it");
                }
            }
        }
        for (String where : loose) {
            b.warn(aggregate.id(), where + " assigns the status to something the states do not name");
        }

        if (transitions.isEmpty()) {
            return null;
        }
        return Catalog.map("states", states, "transitions", transitions);
    }

    /** The enum of the aggregate that carries the table, or names the status field's type. */
    private static ClassTree statusEnum(Domain.Aggregate aggregate) {
        String type = "";
        for (VariableTree field : Source.fields(aggregate.root)) {
            if (field.getName().contentEquals("status")) {
                type = Source.simple(field.getType().toString());
            }
        }
        for (Source.Unit unit : new LinkedHashSet<>(aggregate.unitOf.values())) {
            for (ClassTree declared : unit.classes()) {
                if (Source.isEnum(declared) && (declared.getSimpleName().contentEquals(type) || !table(declared).isEmpty())) {
                    return declared;
                }
            }
        }
        return null;
    }

    /** The constants an enum declares, in the order it declares them. */
    private static List<String> constants(ClassTree type) {
        List<String> out = new ArrayList<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof VariableTree field
                    && field.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)
                    && field.getInitializer() != null
                    && field.getInitializer().toString().startsWith("/*public static final*/")) {
                out.add(field.getName().toString());
            }
        }
        if (!out.isEmpty()) {
            return out;
        }
        // Older shapes of the tree spell an enum constant as a plain field of
        // the enum's own type.
        for (VariableTree field : Source.constants(type)) {
            if (Source.simple(field.getType().toString()).contentEquals(type.getSimpleName())) {
                out.add(field.getName().toString());
            }
        }
        return out;
    }

    /** `TRANSITIONS = Map.of(PENDING, List.of(AUTHORIZED, …), …)`, in the order written. */
    private static Map<String, List<String>> table(ClassTree type) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (VariableTree field : Source.constants(type)) {
            if (!field.getName().contentEquals("TRANSITIONS") || field.getInitializer() == null) {
                continue;
            }
            if (!(field.getInitializer() instanceof MethodInvocationTree call)) {
                continue;
            }
            List<? extends ExpressionTree> args = call.getArguments();
            for (int i = 0; i + 1 < args.size(); i += 2) {
                String from = state(args.get(i));
                List<String> targets = new ArrayList<>();
                if (args.get(i + 1) instanceof MethodInvocationTree list) {
                    for (ExpressionTree target : list.getArguments()) {
                        String to = state(target);
                        if (!to.isEmpty()) {
                            targets.add(to);
                        }
                    }
                }
                if (!from.isEmpty()) {
                    out.put(from, targets);
                }
            }
        }
        return out;
    }

    /** `AUTHORIZED` or `PaymentStatus.AUTHORIZED`, either way the state's name. */
    private static String state(ExpressionTree expression) {
        String text = expression.toString();
        if (text.contains("(") || text.contains("\"")) {
            return "";
        }
        int cut = text.lastIndexOf('.');
        return cut < 0 ? text : text.substring(cut + 1);
    }

    /** The event a mover hands back, as its return type names it. */
    private static String emits(MethodTree method, Map<String, Events.Found> events) {
        if (method.getReturnType() == null) {
            return "";
        }
        Events.Found found = events.get(Source.simple(method.getReturnType().toString()));
        return found == null ? "" : found.id();
    }
}
