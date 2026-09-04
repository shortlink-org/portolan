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
 */
final class Clients {

    /** One method of one adapter, in the catalog's terms. */
    record Call(String id, String pkg, String label, String source) {}

    static final class Client {
        final String name;
        final Source.Unit unit;
        /** The ports of the domain this adapter fills, by simple name. */
        final List<String> implemented;
        final Map<String, Call> calls = new LinkedHashMap<>();

        Client(String name, Source.Unit unit, List<String> implemented) {
            this.name = name;
            this.unit = unit;
            this.implemented = implemented;
        }
    }

    private Clients() {}

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
                Client client = new Client(type.getSimpleName().toString(), unit, fills);
                for (MethodTree method : Source.methods(type)) {
                    for (Proto.Service contract : contracts) {
                        for (Proto.Rpc rpc : contract.rpcs()) {
                            if (Proto.sameName(method.getName().toString(), rpc.name())) {
                                client.calls.put(
                                        method.getName().toString(),
                                        new Call(contract.id() + "/" + rpc.name(), contract.pkg(), rpc.name(), contract.source()));
                            }
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
            if (contracts.isEmpty() && sawAdapter) {
                b.warn(unit.rel, "no contract vendored beside this adapter, so nothing says which rpc its methods answer and every call through it is unresolved");
            }
        }
        return out;
    }
}
