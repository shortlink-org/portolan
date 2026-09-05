package org.portolan.extract;

import com.sun.source.tree.BlockTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.StatementTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.TryTree;
import com.sun.source.tree.VariableTree;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What happens when somebody calls in, or when an event arrives.
 *
 * Statements are read in source order. A call on a port of the domain is a hop
 * into the store, an event handed to the bus is a hop to the bus, a call on an
 * adapter is a hop to the peer. An {@code if} becomes an alt whose branch is
 * terminal when it ends in a return or a throw; a loop and a try are a note on
 * the steps inside. Every step is `declared`: this reads code, and code is a
 * claim about behaviour, not a record of it.
 */
final class Flows {

    static final String LANE_CLIENT = "client";
    static final String LANE_BUS = "bus";

    static final class Options {
        String context = "";
        String svcId = "";
        String service = "";
        String store = "";
        Map<String, String> peers = Map.of();
        Map<String, String> events = Map.of();
    }

    /** What a name means inside one body being walked. */
    private record Binding(String kind, Object value) {}

    private static final class Frame {
        final Source.Unit unit;
        final Map<String, Binding> vars = new LinkedHashMap<>();
        Binding returned;

        Frame(Source.Unit unit) {
            this.unit = unit;
        }
    }

    /** One flow being built: lanes in the order first used, and the steps. */
    private static final class Draft {
        final List<Object> lanes = new ArrayList<>();
        final List<Object> steps = new ArrayList<>();
        final List<List<Object>> sinks = new ArrayList<>();
        final List<String> notes = new ArrayList<>();
        int n;

        String lane(String id, String kind, String context, String label) {
            for (Object lane : lanes) {
                if (id.equals(((Map<?, ?>) lane).get("id"))) {
                    return id;
                }
            }
            lanes.add(Catalog.participant(id, kind, context, label));
            return id;
        }

        List<Object> sink() {
            return sinks.isEmpty() ? steps : sinks.get(sinks.size() - 1);
        }

        void push() {
            sinks.add(new ArrayList<>());
        }

        List<Object> pop() {
            return sinks.remove(sinks.size() - 1);
        }

        String note(String own) {
            Set<String> outer = new LinkedHashSet<>(notes);
            outer.remove("");
            String prefix = outer.isEmpty() ? "" : String.join(", ", outer) + ".";
            return (prefix + " " + own).strip();
        }

        void add(String from, String to, String kind, String label, String status, String ref, String note, String line) {
            n++;
            sink().add(Catalog.step("s" + n, from, to, kind, label, status, ref, note(note), line));
        }

        void addAlt(List<Object> branches) {
            n++;
            sink().add(Catalog.alt("alt" + n, branches));
        }
    }

    private final Options opts;
    private final List<Domain.Aggregate> aggregates;
    private final Map<String, Operations.UseCase> useCases = new LinkedHashMap<>();
    private final Map<String, Clients.Client> clients = new LinkedHashMap<>();
    private final Map<String, Events.Found> events;
    private final Map<String, ClassTree> ports = new LinkedHashMap<>();
    /** port -> the adapter that fills it, when one does. */
    private final Map<String, Clients.Client> adapterOf = new LinkedHashMap<>();
    private final Map<String, Domain.Aggregate> roots = new LinkedHashMap<>();
    private final Protocol.Builder b;
    final Map<String, Map<String, Object>> calls = new LinkedHashMap<>();
    final Set<String> referenced = new LinkedHashSet<>();
    private boolean warnedStore;
    private final Set<String> warnedPeers = new LinkedHashSet<>();

    Flows(Options opts, List<Domain.Aggregate> aggregates, List<Operations.UseCase> useCases,
          List<Clients.Client> clients, Map<String, Events.Found> events, Protocol.Builder b) {
        this.opts = opts;
        this.aggregates = aggregates;
        this.events = events;
        this.b = b;
        for (Operations.UseCase useCase : useCases) {
            this.useCases.put(useCase.id, useCase);
        }
        for (Clients.Client client : clients) {
            this.clients.put(client.name, client);
            for (String port : client.implemented) {
                adapterOf.putIfAbsent(port, client);
            }
        }
        for (Domain.Aggregate aggregate : aggregates) {
            roots.put(aggregate.root.getSimpleName().toString(), aggregate);
            for (ClassTree port : aggregate.ports) {
                ports.put(port.getSimpleName().toString(), port);
            }
        }
    }

    // --- lanes ---------------------------------------------------------------

    private String storeLane(Draft d) {
        if (opts.store.isEmpty()) {
            if (!warnedStore) {
                warnedStore = true;
                b.warn(opts.svcId, "no store named in the options, so calls on a port stay on the service's own lane");
            }
            return opts.svcId;
        }
        return d.lane(opts.service + "-" + opts.store, "store", opts.context, "");
    }

    private String[] peerLane(Draft d, String pkg) {
        String service = opts.peers.get(pkg);
        if (service != null && !service.isEmpty()) {
            return new String[] {d.lane(service, "service", service.substring(0, service.indexOf('.')), ""), service, Catalog.DECLARED};
        }
        if (warnedPeers.add(pkg)) {
            b.warn(opts.svcId, "calls " + pkg + " and the manifest names no peer for it; add it under `peers` to say which service answers, until then the calls are unresolved");
        }
        return new String[] {d.lane(pkg.replace('.', '-'), "unknown", null, pkg), pkg, Catalog.UNRESOLVED};
    }

    List<Object> consumes() {
        List<String> ids = new ArrayList<>(calls.keySet());
        ids.sort(String::compareTo);
        List<Object> out = new ArrayList<>();
        for (String id : ids) {
            out.add(calls.get(id));
        }
        return out;
    }

    // --- the two openings ----------------------------------------------------

    Map<String, Object> endpointFlow(Transport.Endpoint endpoint) {
        Draft d = new Draft();
        d.lane(LANE_CLIENT, "actor", null, "");
        d.lane(opts.svcId, "service", opts.context, "");
        d.add(LANE_CLIENT, opts.svcId, "rpc", endpoint.id, Catalog.DECLARED, "", "", endpoint.unit.where(endpoint.method));

        Frame frame = new Frame(endpoint.unit);
        seed(frame, endpoint.handler);
        List<Operations.UseCase> ran = new ArrayList<>();
        walk(d, frame, endpoint.method.getBody(), 0, ran);
        for (Operations.UseCase useCase : ran) {
            endpoint.useCases.add(useCase.id);
        }

        String name = Ids.slug(endpoint.id);
        String id = opts.service + "-" + name;
        return Catalog.flow(
                "flow." + id,
                id,
                sentence(name),
                ran.isEmpty() ? endpoint.doc : ran.get(ran.size() - 1).doc,
                endpoint.unit.rel,
                opts.context,
                d.lanes,
                d.steps);
    }

    Map<String, Object> policyFlow(Source.Unit unit, ClassTree type, MethodTree method) {
        String[] trigger = trigger(unit, method);
        if (trigger == null) {
            b.warn(opts.svcId, unit.rel + ": " + type.getSimpleName() + " reacts to an event this repository does not declare and the manifest's `events` does not place; the flow is left out");
            return null;
        }
        Draft d = new Draft();
        d.lane(LANE_BUS, "broker", null, "");
        d.lane(opts.svcId, "service", opts.context, "");
        d.add(LANE_BUS, opts.svcId, "event", trigger[1], Catalog.DECLARED, trigger[0], "", unit.where(method));
        referenced.add(trigger[0]);

        Frame frame = new Frame(unit);
        seed(frame, type);
        walk(d, frame, method.getBody(), 0, new ArrayList<>());

        String id = opts.service + "-" + Ids.slug(type.getSimpleName().toString());
        return Catalog.flow(
                "flow." + id,
                id,
                sentence(Ids.slug(type.getSimpleName().toString())),
                unit.doc(type),
                unit.rel,
                opts.context,
                d.lanes,
                d.steps);
    }

    /** What a listener reacts to: the type of its argument, placed by the manifest when it is not ours. */
    private String[] trigger(Source.Unit unit, MethodTree method) {
        if (method.getParameters().isEmpty()) {
            return null;
        }
        String type = Source.simple(method.getParameters().get(0).getType().toString());
        Events.Found local = events.get(type);
        if (local != null) {
            return new String[] {local.id(), local.name()};
        }
        String qualified = unit.resolve(type);
        for (Map.Entry<String, String> entry : opts.events.entrySet()) {
            if (qualified.equals(entry.getKey()) || qualified.startsWith(entry.getKey() + ".")) {
                return new String[] {entry.getValue() + "." + type, type};
            }
        }
        return null;
    }

    /** The constructor parameters of a handler, a use case or a policy: what it holds. */
    private void seed(Frame frame, ClassTree type) {
        for (VariableTree parameter : Operations.ports(type)) {
            Binding binding = bindingOf(Source.simple(parameter.getType().toString()));
            if (binding != null) {
                frame.vars.put(parameter.getName().toString(), binding);
            }
        }
    }

    private Binding bindingOf(String type) {
        if (useCases.containsKey(type)) {
            return new Binding("usecase", useCases.get(type));
        }
        if (clients.containsKey(type)) {
            return new Binding("client", clients.get(type));
        }
        // A type named for publishing is the bus wherever it is declared: the
        // domain's own Publisher port as much as an infrastructure Bus.
        if (type.equals("Bus") || type.endsWith("Publisher") || type.endsWith("Events")) {
            return new Binding("bus", type);
        }
        if (ports.containsKey(type)) {
            return new Binding("port", ports.get(type));
        }
        // A port the use case declared for itself, filled by the adapter that
        // implements it; the call lands wherever that adapter's contract says.
        if (adapterOf.containsKey(type)) {
            return new Binding("client", adapterOf.get(type));
        }
        return null;
    }

    // --- the walk ------------------------------------------------------------

    private void walk(Draft d, Frame frame, Tree body, int depth, List<Operations.UseCase> ran) {
        if (!(body instanceof BlockTree block)) {
            return;
        }
        for (StatementTree statement : block.getStatements()) {
            statement(d, frame, statement, depth, ran);
        }
    }

    private void statement(Draft d, Frame frame, StatementTree statement, int depth, List<Operations.UseCase> ran) {
        switch (statement) {
            case VariableTree variable -> {
                if (variable.getInitializer() != null) {
                    Binding binding = value(d, frame, variable.getInitializer(), depth, ran);
                    if (binding != null) {
                        frame.vars.put(variable.getName().toString(), binding);
                    }
                }
            }
            case ExpressionStatementTree expression -> value(d, frame, expression.getExpression(), depth, ran);
            case ReturnTree returned -> {
                if (returned.getExpression() != null) {
                    frame.returned = value(d, frame, returned.getExpression(), depth, ran);
                }
            }
            case IfTree branch -> choice(d, frame, branch, depth, ran);
            case TryTree attempt -> {
                walk(d, frame, attempt.getBlock(), depth, ran);
                for (var handler : attempt.getCatches()) {
                    d.notes.add("on " + Source.simple(handler.getParameter().getType().toString()));
                    walk(d, frame, handler.getBlock(), depth, ran);
                    d.notes.remove(d.notes.size() - 1);
                }
            }
            case com.sun.source.tree.EnhancedForLoopTree loop -> {
                d.notes.add("for each " + loop.getVariable().getName());
                walk(d, frame, loop.getStatement(), depth, ran);
                d.notes.remove(d.notes.size() - 1);
            }
            case com.sun.source.tree.ForLoopTree loop -> {
                d.notes.add("in a loop");
                walk(d, frame, loop.getStatement(), depth, ran);
                d.notes.remove(d.notes.size() - 1);
            }
            case com.sun.source.tree.WhileLoopTree loop -> {
                d.notes.add("while " + condition(loop.getCondition()));
                walk(d, frame, loop.getStatement(), depth, ran);
                d.notes.remove(d.notes.size() - 1);
            }
            case BlockTree block -> walk(d, frame, block, depth, ran);
            default -> {
            }
        }
    }

    /** The outermost calls in an expression, each valued for the hops it makes; what they return is not needed here. */
    private void asked(Draft d, Frame frame, ExpressionTree expression, int depth, List<Operations.UseCase> ran) {
        new com.sun.source.util.TreeScanner<Void, Void>() {
            @Override
            public Void visitMethodInvocation(MethodInvocationTree call, Void ignored) {
                value(d, frame, call, depth, ran);
                return null; // the invocation values its own arguments
            }
        }.scan(expression, null);
    }

    private void choice(Draft d, Frame frame, IfTree branch, int depth, List<Operations.UseCase> ran) {
        List<Object> branches = new ArrayList<>();
        StatementTree current = branch;
        while (current instanceof IfTree node) {
            // A call made to decide the branch is a hop before the branch:
            // `if (orders.standing(id) == CANCELLED)` asks the order service.
            asked(d, frame, node.getCondition(), depth, ran);
            d.push();
            walk(d, frame, block(node.getThenStatement()), depth, ran);
            branches.add(Catalog.branch(condition(node.getCondition()), d.pop(), terminal(node.getThenStatement())));
            StatementTree otherwise = node.getElseStatement();
            if (otherwise instanceof IfTree next) {
                current = next;
                continue;
            }
            if (otherwise != null) {
                d.push();
                walk(d, frame, block(otherwise), depth, ran);
                branches.add(Catalog.branch("otherwise", d.pop(), terminal(otherwise)));
            }
            current = null;
        }
        boolean holdsAHop = false;
        for (Object arm : branches) {
            holdsAHop |= !((List<?>) ((Map<?, ?>) arm).get("steps")).isEmpty();
        }
        if (!holdsAHop) {
            return;
        }
        // An alt states a choice, and a choice has at least two outcomes. An
        // `if` with no `else` has a second one - nothing happens - and saying
        // so is what keeps the diagram from reading as "this always runs".
        if (branches.size() == 1) {
            branches.add(Catalog.branch("otherwise", List.of(), false));
        }
        d.addAlt(branches);
    }

    private static Tree block(StatementTree statement) {
        return statement;
    }

    private static boolean terminal(StatementTree statement) {
        if (statement instanceof BlockTree block && !block.getStatements().isEmpty()) {
            StatementTree last = block.getStatements().get(block.getStatements().size() - 1);
            return last instanceof ReturnTree || last instanceof com.sun.source.tree.ThrowTree;
        }
        return statement instanceof ReturnTree || statement instanceof com.sun.source.tree.ThrowTree;
    }

    /** What an expression holds, and every hop it makes on the way. */
    private Binding value(Draft d, Frame frame, ExpressionTree expression, int depth, List<Operations.UseCase> ran) {
        switch (expression) {
            case com.sun.source.tree.IdentifierTree name -> {
                return frame.vars.get(name.getName().toString());
            }
            case com.sun.source.tree.MemberSelectTree select -> {
                return frame.vars.get(select.toString());
            }
            case NewClassTree created -> {
                String type = Source.simple(created.getIdentifier().toString());
                for (ExpressionTree argument : created.getArguments()) {
                    value(d, frame, argument, depth, ran);
                }
                Events.Found event = events.get(type);
                if (event != null) {
                    return new Binding("event", event.id());
                }
                Domain.Aggregate aggregate = roots.get(type);
                return aggregate == null ? null : new Binding("root", aggregate);
            }
            case MethodInvocationTree call -> {
                return invocation(d, frame, call, depth, ran);
            }
            default -> {
                return null;
            }
        }
    }

    private Binding invocation(Draft d, Frame frame, MethodInvocationTree call, int depth, List<Operations.UseCase> ran) {
        String select = call.getMethodSelect().toString();
        String method = Source.simple(select);
        String receiver = select.contains(".") ? select.substring(0, select.lastIndexOf('.')) : "";
        String line = frame.unit.where(call);

        // The receiver first, then the arguments: a chain is read the way it is
        // written, so a call on the result of a call lands where it is made.
        Binding holder = null;
        if (!receiver.isEmpty()) {
            holder = frame.vars.get(receiver);
            if (holder == null && call.getMethodSelect() instanceof com.sun.source.tree.MemberSelectTree member
                    && member.getExpression() instanceof MethodInvocationTree inner) {
                holder = invocation(d, frame, inner, depth, ran);
            }
        }
        List<Binding> arguments = new ArrayList<>();
        for (ExpressionTree argument : call.getArguments()) {
            arguments.add(value(d, frame, argument, depth, ran));
        }

        if (holder == null) {
            return null;
        }
        switch (holder.kind()) {
            case "port" -> {
                ClassTree port = (ClassTree) holder.value();
                String portName = port.getSimpleName().toString();
                // A repository is the store; any other port is whatever fills
                // it, and the adapter beside its contract says where that is.
                Clients.Client adapter = adapterOf.get(portName);
                if (adapter != null) {
                    return rpc(d, adapter, method, line);
                }
                if (!isRepository(port)) {
                    b.warn(opts.svcId, portName + " is a port of the domain that nothing in this service fills, so a call on it goes nowhere the catalog can name");
                    return null;
                }
                d.add(opts.svcId, storeLane(d), "call", method, Catalog.DECLARED, "", "", line);
                return returnedByPort(port, method);
            }
            case "client" -> {
                return rpc(d, (Clients.Client) holder.value(), method, line);
            }
            case "bus" -> {
                for (Binding argument : arguments) {
                    if (argument != null && argument.kind().equals("event")) {
                        publish(d, (String) argument.value(), line);
                    }
                }
                return null;
            }
            case "usecase" -> {
                return inline(d, (Operations.UseCase) holder.value(), arguments, depth, ran, line);
            }
            case "root" -> {
                Domain.Aggregate aggregate = (Domain.Aggregate) holder.value();
                String emitted = emits(aggregate, method);
                return emitted.isEmpty() ? holder : new Binding("event", emitted);
            }
            default -> {
                return null;
            }
        }
    }

    /** A repository is the one port whose other end is the service's own store. */
    private static boolean isRepository(ClassTree port) {
        return Source.annotated(port.getModifiers(), "Repository")
                || port.getSimpleName().toString().endsWith("Repository");
    }

    private Binding rpc(Draft d, Clients.Client client, String method, String line) {
        Clients.Call found = client.calls.get(method);
        if (found == null) {
            return null;
        }
        String[] lane = peerLane(d, found.pkg());
        boolean resolved = lane[2].equals(Catalog.DECLARED);
        d.add(opts.svcId, lane[0], "rpc", found.label(), lane[2], resolved ? found.id() : "", "", line);
        calls.put(found.id(), Catalog.rpcCall(found.id(), lane[1], lane[2], found.source()));
        return null;
    }

    /** A port's method hands something back, and its type says what. */
    private Binding returnedByPort(ClassTree port, String method) {
        for (MethodTree declared : Source.methods(port)) {
            if (!declared.getName().contentEquals(method) || declared.getReturnType() == null) {
                continue;
            }
            String type = declared.getReturnType().toString();
            for (Map.Entry<String, Domain.Aggregate> root : roots.entrySet()) {
                if (type.contains(root.getKey())) {
                    return new Binding("root", root.getValue());
                }
            }
        }
        return null;
    }

    /** A method of the root hands back the event of the move it made. */
    private String emits(Domain.Aggregate aggregate, String method) {
        for (MethodTree declared : Source.methods(aggregate.root)) {
            if (declared.getName().contentEquals(method) && declared.getReturnType() != null) {
                Events.Found found = events.get(Source.simple(declared.getReturnType().toString()));
                return found == null ? "" : found.id();
            }
        }
        return "";
    }

    private void publish(Draft d, String eventId, String line) {
        d.add(opts.svcId, d.lane(LANE_BUS, "broker", null, ""), "event", eventId.substring(eventId.lastIndexOf('.') + 1), Catalog.DECLARED, eventId, "", line);
        referenced.add(eventId);
    }

    /** A use case runs here, so its steps are drawn here - two deep at most. */
    private Binding inline(Draft d, Operations.UseCase useCase, List<Binding> arguments, int depth, List<Operations.UseCase> ran, String line) {
        if (!ran.contains(useCase)) {
            ran.add(useCase);
        }
        if (depth >= 2) {
            d.add(opts.svcId, opts.svcId, "call", useCase.id, Catalog.DECLARED, "", "Runs the use case, whose steps are not drawn again here.", line);
            return null;
        }
        Frame inner = new Frame(useCase.unit);
        seed(inner, useCase.type);
        List<? extends VariableTree> parameters = useCase.entry.getParameters();
        for (int i = 0; i < parameters.size() && i < arguments.size(); i++) {
            if (arguments.get(i) != null) {
                inner.vars.put(parameters.get(i).getName().toString(), arguments.get(i));
            }
        }
        walk(d, inner, useCase.entry.getBody(), depth + 1, ran);
        return inner.returned;
    }

    private static String condition(ExpressionTree expression) {
        String text = String.join(" ", expression.toString().split("\\s+")).strip();
        // javac keeps the parentheses of the `if`; the condition reads as a
        // sentence on the page, so they come off.
        while (text.startsWith("(") && text.endsWith(")")) {
            text = text.substring(1, text.length() - 1).strip();
        }
        return text.length() <= 72 ? text : text.substring(0, 69) + "...";
    }

    static String sentence(String text) {
        String words = text.replace('-', ' ').replace('_', ' ').strip();
        return words.isEmpty() ? "" : Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}
