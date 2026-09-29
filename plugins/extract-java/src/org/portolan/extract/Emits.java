package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.TreeScanner;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.lang.model.element.Modifier;

/**
 * What a use case can publish, read off the domain calls it makes.
 *
 * <pre>
 * public PaymentCaptured capture(String at) { … return new PaymentCaptured(…); }
 *
 * public PaymentCaptured handle(String id, String at) {
 *     var payment = payments.byId(id).orElseThrow();
 *     var captured = payment.capture(at);
 *     …
 * }
 * </pre>
 *
 * The domain says which of its methods produce which events: a method of the
 * root, a constructor of the root, or a static factory of a class in the
 * aggregate's package produces the events its return type names and the events
 * it builds with {@code new} - {@code registerEvent(new PaymentCaptured(…))}
 * builds one as much as a {@code return} does - and whatever the methods of the
 * same class it calls produce. The use case says which of those it calls. The
 * event is the domain's to name, and the use case only decides whether to run
 * the method that names it - so the operation emits what it reaches, whether
 * or not a branch keeps the result.
 *
 * Calls are matched by name, since nothing here resolves a type: a root method
 * by its name on any receiver, a static factory by the class it is called on. A
 * repository method that happens to share a name with an emitting root method
 * is read as that method; the names of a root are chosen to say what the
 * aggregate does, and the collision is rare enough to take.
 */
final class Emits {

    private static final String INIT = "<init>";

    private final String root;
    private final Set<String> domainTypes;
    private final Map<String, String> events = new LinkedHashMap<>();   // class name -> event id
    private final Map<String, Integer> order = new LinkedHashMap<>();   // event id -> position in the aggregate
    /** `Type#method` -> the events it produces; a root constructor is `Root#<init>`. */
    private final Map<String, Set<String>> produces = new LinkedHashMap<>();

    private Emits(Domain.Aggregate aggregate) {
        this.root = aggregate.root.getSimpleName().toString();
        this.domainTypes = aggregate.unitOf.keySet();
        int at = 0;
        for (Object raw : (List<?>) aggregate.object.get("events")) {
            Map<?, ?> event = (Map<?, ?>) raw;
            String id = String.valueOf(event.get("id"));
            events.put(String.valueOf(event.get("name")), id);
            order.put(id, at++);
        }
    }

    /** The emitting methods of one aggregate, read once for all its use cases. */
    static Emits of(Domain.Aggregate aggregate) {
        Emits e = new Emits(aggregate);
        if (e.events.isEmpty()) {
            return e;
        }

        // Each method's own events and the methods it calls, then the calls
        // folded in until nothing changes: a command that records through a
        // private helper emits what the helper builds.
        Map<String, Set<String>> calls = new LinkedHashMap<>();
        for (Source.Unit unit : new LinkedHashSet<>(aggregate.unitOf.values())) {
            for (ClassTree type : unit.classes()) {
                String name = type.getSimpleName().toString();
                boolean isRoot = type == aggregate.root;
                for (Tree member : type.getMembers()) {
                    if (!(member instanceof MethodTree method) || method.getBody() == null) {
                        continue;
                    }
                    boolean constructor = method.getName().contentEquals(INIT);
                    boolean isStatic = method.getModifiers().getFlags().contains(Modifier.STATIC);
                    // Past the root only a static factory is something a use
                    // case can reach without holding another aggregate.
                    if (!isRoot && (constructor || !isStatic)) {
                        continue;
                    }
                    String key = name + "#" + method.getName();
                    Set<String> own = e.produces.computeIfAbsent(key, k -> new LinkedHashSet<>());
                    if (!constructor) {
                        own.addAll(e.named(method.getReturnType()));
                    }
                    e.scan(name, method.getBody(), own, calls.computeIfAbsent(key, k -> new LinkedHashSet<>()));
                }
            }
        }
        for (boolean changed = true; changed; ) {
            changed = false;
            for (Map.Entry<String, Set<String>> entry : calls.entrySet()) {
                Set<String> own = e.produces.get(entry.getKey());
                for (String callee : entry.getValue()) {
                    Set<String> reached = e.produces.get(callee);
                    if (reached != null && own.addAll(reached)) {
                        changed = true;
                    }
                }
            }
        }
        return e;
    }

    /** What one use case reaches, in the aggregate's event order; empty when it reaches nothing. */
    List<String> of(Operations.UseCase useCase) {
        if (events.isEmpty()) {
            return List.of();
        }
        Set<String> found = new LinkedHashSet<>();
        Set<String> calls = new LinkedHashSet<>();
        scan(useCase.type.getSimpleName().toString(), useCase.type, found, calls);
        for (String callee : calls) {
            found.addAll(produces.getOrDefault(callee, Set.of()));
        }
        List<String> out = new ArrayList<>(found);
        out.sort(Comparator.comparing(order::get));
        return out;
    }

    /**
     * The events a subtree builds and the domain methods it calls. {@code self}
     * is the class the subtree is in: an unqualified call, or one on {@code this},
     * is to its own methods.
     */
    private void scan(String self, Tree tree, Set<String> own, Set<String> calls) {
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitNewClass(NewClassTree node, Void ignored) {
                String type = Source.simple(node.getIdentifier().toString());
                String event = events.get(type);
                if (event != null) {
                    own.add(event);
                } else if (type.equals(root)) {
                    calls.add(root + "#" + INIT);
                }
                return super.visitNewClass(node, ignored);
            }

            @Override
            public Void visitMethodInvocation(MethodInvocationTree node, Void ignored) {
                switch (node.getMethodSelect()) {
                    case IdentifierTree name -> {
                        String method = name.getName().toString();
                        calls.add(self + "#" + (method.equals("this") ? INIT : method));
                    }
                    case MemberSelectTree select -> {
                        String method = select.getIdentifier().toString();
                        String receiver = select.getExpression().toString();
                        if (receiver.equals("this")) {
                            calls.add(self + "#" + method);
                        } else if (select.getExpression() instanceof IdentifierTree type && domainTypes.contains(type.getName().toString())) {
                            calls.add(type.getName() + "#" + method);
                        } else {
                            calls.add(root + "#" + method);
                        }
                    }
                    default -> {}
                }
                return super.visitMethodInvocation(node, ignored);
            }
        }.scan(tree, null);
    }

    /**
     * The events a return type names: {@code PaymentCaptured}, and the ones
     * inside a wrapper - {@code Optional<PaymentCaptured>}, or a pair of the
     * root and what making it recorded - since Java hands back one value.
     */
    private Set<String> named(Tree type) {
        Set<String> out = new LinkedHashSet<>();
        if (type == null) {
            return out;
        }
        new TreeScanner<Void, Void>() {
            @Override
            public Void visitIdentifier(IdentifierTree node, Void ignored) {
                String event = events.get(node.getName().toString());
                if (event != null) {
                    out.add(event);
                }
                return null;
            }

            @Override
            public Void visitMemberSelect(MemberSelectTree node, Void ignored) {
                String event = events.get(node.getIdentifier().toString());
                if (event != null) {
                    out.add(event);
                }
                return null;
            }
        }.scan(type, null);
        return out;
    }
}
