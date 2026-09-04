package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodTree;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The way in.
 *
 * A class saying {@code @GrpcService} answers a contract, and the contract is
 * the .proto vendored beside it: a method of the class whose name is an rpc of
 * that service is the endpoint for it. The proto's spelling is the endpoint's
 * id, so what this says and what `extract-proto` puts in `provides` are one
 * name - which is what pairs an operation with the interface that exposes it.
 */
final class Transport {

    static final class Endpoint {
        final String id;            // Authorize
        final MethodTree method;
        final Source.Unit unit;
        final ClassTree handler;
        final String doc;
        final List<String> useCases = new ArrayList<>();

        Endpoint(String id, MethodTree method, Source.Unit unit, ClassTree handler, String doc) {
            this.id = id;
            this.method = method;
            this.unit = unit;
            this.handler = handler;
            this.doc = doc;
        }
    }

    private Transport() {}

    static List<Endpoint> read(Source.Project project, java.util.function.Function<Path, String> rel, Protocol.Builder b) throws IOException {
        List<Endpoint> out = new ArrayList<>();
        for (Source.Unit unit : project.units) {
            if (!unit.packageName.contains(".transport.")) {
                continue;
            }
            List<Proto.Service> contracts = Proto.under(unit.path.getParent().resolve("proto"), rel);
            for (ClassTree type : unit.classes()) {
                if (!Source.annotated(type.getModifiers(), "GrpcService", "RestController", "Controller")) {
                    continue;
                }
                if (contracts.isEmpty()) {
                    b.warn(unit.rel, type.getSimpleName() + " answers no contract this can find: vendor the .proto beside it");
                    continue;
                }
                for (MethodTree method : Source.methods(type)) {
                    for (Proto.Service contract : contracts) {
                        for (Proto.Rpc rpc : contract.rpcs()) {
                            if (Proto.sameName(method.getName().toString(), rpc.name())) {
                                out.add(new Endpoint(rpc.name(), method, unit, type, unit.doc(method)));
                            }
                        }
                    }
                }
                for (Proto.Service contract : contracts) {
                    for (Proto.Rpc rpc : contract.rpcs()) {
                        boolean answered = Source.methods(type).stream().anyMatch(m -> Proto.sameName(m.getName().toString(), rpc.name()));
                        if (!answered) {
                            b.warn(unit.rel, contract.id() + "/" + rpc.name() + " is declared by the contract and answered by no method of " + type.getSimpleName());
                        }
                    }
                }
            }
        }
        out.sort(Comparator.comparing(e -> e.id));
        return out;
    }

    /** `@ApplicationModuleListener` and friends: what runs when an event arrives. */
    static List<Object[]> policies(Source.Project project) {
        List<Object[]> out = new ArrayList<>();
        for (Source.Unit unit : project.units) {
            for (ClassTree type : unit.classes()) {
                for (MethodTree method : Source.methods(type)) {
                    if (Source.annotated(method.getModifiers(), "ApplicationModuleListener", "EventListener", "DomainEventHandler")) {
                        out.add(new Object[] {unit, type, method});
                    }
                }
            }
        }
        return out;
    }
}
