package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodTree;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A call to another service, read off the adapter that makes it.
 *
 * `infrastructure/<peer>/` holds the contract vendored from the callee and the
 * class that calls it. A method of that class answering an rpc of the contract
 * is that rpc: `getOrder` and `GetOrder` are one name, so the call is recorded
 * under the id the callee's own extractor gives it - `shop.v1.OrderService/GetOrder`.
 *
 * An HTTP peer is read the other way round, because nothing in the code names
 * the operation: the method's body calls `http.post("/v1/charges/" + id + "/capture", …)`,
 * the verb and the route are in the call, and the OpenAPI document vendored
 * beside the adapter says which operation answers there - so the call is
 * `stripe.v1/PostPaymentIntentsIntentCapture`, spelled the way the document's
 * own extractor spells it.
 */
final class Clients {

    /** One method of one adapter, in the catalog's terms. */
    record Call(String id, String pkg, String label, String source) {}

    /** A verb and a route, as the body of a method spells them. */
    record Route(String verb, String path) {}

    static final class Client {
        final String name;
        final Source.Unit unit;
        /** Every interface this adapter implements, by simple name: the domain's ports and any a use case declared for itself. */
        final List<String> implemented;
        final Map<String, Call> calls = new LinkedHashMap<>();

        Client(String name, Source.Unit unit, List<String> implemented) {
            this.name = name;
            this.unit = unit;
            this.implemented = implemented;
        }
    }

    private Clients() {}

    /** Whether the method's body calls something named like the rpc - `stub.getOrder(...)` for `GetOrder`. */
    private static boolean invokes(MethodTree method, String rpc) {
        boolean[] found = {false};
        new com.sun.source.util.TreeScanner<Void, Void>() {
            @Override
            public Void visitMethodInvocation(com.sun.source.tree.MethodInvocationTree call, Void ignored) {
                String name = switch (call.getMethodSelect()) {
                    case com.sun.source.tree.MemberSelectTree select -> select.getIdentifier().toString();
                    case com.sun.source.tree.IdentifierTree ident -> ident.getName().toString();
                    default -> "";
                };
                if (Proto.sameName(name, rpc)) {
                    found[0] = true;
                }
                return super.visitMethodInvocation(call, ignored);
            }
        }.scan(method, null);
        return found[0];
    }

    /** Every HTTP call in the method's body - `x.post("/v1/charges", …)` - with the route as far as the code spells it. */
    static List<Route> routes(MethodTree method) {
        List<Route> out = new ArrayList<>();
        new com.sun.source.util.TreeScanner<Void, Void>() {
            @Override
            public Void visitMethodInvocation(com.sun.source.tree.MethodInvocationTree call, Void ignored) {
                String name = switch (call.getMethodSelect()) {
                    case com.sun.source.tree.MemberSelectTree select -> select.getIdentifier().toString();
                    case com.sun.source.tree.IdentifierTree ident -> ident.getName().toString();
                    default -> "";
                };
                if (OpenApi.VERBS.contains(name.toLowerCase()) && !call.getArguments().isEmpty()) {
                    String path = routeOf(call.getArguments().get(0));
                    if (path != null && path.startsWith("/")) {
                        out.add(new Route(name.toUpperCase(), path));
                    }
                }
                return super.visitMethodInvocation(call, ignored);
            }
        }.scan(method, null);
        return out;
    }

    /**
     * The route an expression spells: a literal as written, a concatenation with
     * every non-literal part standing in as a parameter, so that
     * `"/v1/payment_intents/" + id + "/capture"` is `/v1/payment_intents/{}/capture`
     * and lands on `/v1/payment_intents/{intent}/capture`. Anything else is null.
     */
    private static String routeOf(com.sun.source.tree.ExpressionTree expression) {
        return switch (expression) {
            case com.sun.source.tree.LiteralTree literal when literal.getValue() instanceof String s -> s;
            case com.sun.source.tree.ParenthesizedTree parens -> routeOf(parens.getExpression());
            case com.sun.source.tree.BinaryTree binary when binary.getKind() == com.sun.source.tree.Tree.Kind.PLUS -> {
                String left = routeOf(binary.getLeftOperand());
                String right = routeOf(binary.getRightOperand());
                if (left == null && right == null) {
                    yield null;
                }
                yield (left == null ? "{}" : left) + (right == null ? "{}" : right);
            }
            case com.sun.source.tree.MethodInvocationTree call when call.getMethodSelect().toString().endsWith("format") && !call.getArguments().isEmpty() ->
                    routeOf(call.getArguments().get(0));
            default -> null;
        };
    }

    static List<Client> read(Source.Project project, java.util.Set<String> ports, java.util.function.Function<Path, String> rel, Protocol.Builder b) throws IOException {
        List<Client> out = new ArrayList<>();
        for (Source.Unit unit : project.units) {
            int at = unit.packageName.indexOf(".infrastructure.");
            if (at < 0) {
                continue;
            }
            String rest = unit.packageName.substring(at + ".infrastructure.".length());
            String peer = rest.contains(".") ? rest.substring(0, rest.indexOf('.')) : rest;
            if (peer.equals("transport") || peer.equals("repository") || peer.equals("bus")
                    || unit.packageName.endsWith(".event") || unit.packageName.endsWith(".events")
                    || unit.packageName.endsWith(".gen")) {
                continue;
            }
            List<Proto.Service> contracts = Proto.under(unit.path.getParent().resolve("proto"), rel);
            List<OpenApi.Spec> documents = OpenApi.under(unit.path.getParent(), rel);
            boolean sawAdapter = false;
            for (ClassTree type : unit.classes()) {
                if (Source.isInterface(type) || Source.isRecord(type)) {
                    continue;
                }
                boolean declared = Source.annotated(type.getModifiers(), "SecondaryAdapter", "Adapter");
                List<String> fills = new ArrayList<>(Source.supertypes(type));
                fills.retainAll(ports);
                if (!declared && fills.isEmpty()) {
                    continue;
                }
                sawAdapter = true;
                Client client = new Client(type.getSimpleName().toString(), unit, new ArrayList<>(Source.supertypes(type)));
                for (MethodTree method : Source.methods(type)) {
                    String own = method.getName().toString();
                    for (Proto.Service contract : contracts) {
                        for (Proto.Rpc rpc : contract.rpcs()) {
                            // The adapter's method is the rpc it is named after or, when
                            // the port it fills speaks the use case's words rather than
                            // the contract's, the rpc its body invokes on the stub.
                            if (Proto.sameName(own, rpc.name()) || invokes(method, rpc.name())) {
                                client.calls.putIfAbsent(
                                        own,
                                        new Call(contract.id() + "/" + rpc.name(), contract.pkg(), rpc.name(), contract.source()));
                            }
                        }
                    }
                    // An HTTP peer: the verb and the route are in the body, and
                    // the document vendored beside the adapter says which
                    // operation answers there. A method that makes two calls is
                    // the first one it makes.
                    for (OpenApi.Spec document : documents) {
                        for (Route route : routes(method)) {
                            OpenApi.Operation operation = document.find(route.verb(), route.path());
                            if (operation == null) {
                                b.warn(document.source(), own + " calls " + route.verb() + " " + route.path() + ", which the document does not declare; the call is left out");
                                continue;
                            }
                            client.calls.putIfAbsent(own, new Call(document.callId(operation), document.api(), operation.id(), document.source()));
                        }
                    }
                }
                if (client.calls.isEmpty()) {
                    // A peer nobody wrote a contract for is still a peer: its
                    // methods are the calls, and every one of them stays
                    // unresolved until a document says what answers.
                    for (MethodTree method : Source.methods(type)) {
                        if (method.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.PUBLIC)) {
                            String name = method.getName().toString();
                            client.calls.put(name, new Call(peer + "/" + name, peer, name, unit.rel));
                        }
                    }
                }
                if (client.calls.isEmpty()) {
                    continue;
                }
                if (!declared) {
                    b.warn(unit.rel, type.getSimpleName() + " is read as an adapter because of where it sits; @SecondaryAdapter would say so outright");
                }
                out.add(client);
            }
            if (contracts.isEmpty() && documents.isEmpty() && sawAdapter) {
                b.warn(unit.rel, "no contract vendored beside this adapter, so nothing says which rpc its methods answer and every call through it is unresolved");
            }
        }
        return out;
    }
}
