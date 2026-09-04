package org.portolan.extract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One Java service in, one fragment out.
 *
 * A fragment, not a catalog: it carries one context and one service, names
 * peers it does not own, and is merged with everything else before anything
 * validates it.
 */
final class Extract {

    private static final Pattern SCM = Pattern.compile("(?s)<scm>.*?<url>\\s*([^<\\s]+)\\s*</url>");

    private Extract() {}

    static void run(Protocol.Input input, Protocol.Options opts, Protocol.Builder b, Path cwd) throws IOException {
        Path root = cwd.resolve(input.root()).normalize();
        java.util.function.Function<Path, String> rel = path -> cwd.relativize(path).toString().replace('\\', '/');

        String context = opts.context.isEmpty() ? root.getFileName().toString() : opts.context;
        String service = opts.service.isEmpty() ? root.getFileName().toString() : opts.service;
        String svcId = Ids.serviceId(context, service);

        Path source = root.resolve(opts.source.isEmpty() ? "src/main/java" : opts.source).normalize();
        Source.Project project = Source.parse(source, rel);
        for (String[] problem : project.broken) {
            b.warn(problem[0], problem[1]);
        }
        if (project.units.isEmpty()) {
            b.warn(svcId, "no Java source under " + rel.apply(source) + ": there is nothing here to read");
        }

        List<Domain.Aggregate> aggregates = Domain.read(project, svcId, root, b);
        Map<String, Events.Found> events = new LinkedHashMap<>();
        for (Domain.Aggregate aggregate : aggregates) {
            events.putAll(Events.read(aggregate, service, b));
        }

        List<Operations.UseCase> useCases = Operations.read(project, b);
        java.util.Set<String> ports = new java.util.LinkedHashSet<>();
        for (Domain.Aggregate aggregate : aggregates) {
            for (com.sun.source.tree.ClassTree port : aggregate.ports) {
                ports.add(port.getSimpleName().toString());
            }
        }
        List<Clients.Client> clients = Clients.read(project, ports, rel, b);
        List<Transport.Endpoint> endpoints = Transport.read(project, rel, b);

        Flows.Options flowOptions = new Flows.Options();
        flowOptions.context = context;
        flowOptions.svcId = svcId;
        flowOptions.service = service;
        flowOptions.store = opts.store;
        flowOptions.peers = opts.peers;
        flowOptions.events = opts.events;
        Flows reader = new Flows(flowOptions, aggregates, useCases, clients, events, b);

        List<Object> flows = new ArrayList<>();
        Map<String, List<String>> exposed = new LinkedHashMap<>();
        for (Transport.Endpoint endpoint : endpoints) {
            flows.add(reader.endpointFlow(endpoint));
            for (String useCase : endpoint.useCases) {
                exposed.computeIfAbsent(useCase, key -> new ArrayList<>()).add(endpoint.id);
            }
        }
        for (Object[] policy : Transport.policies(project)) {
            Map<String, Object> flow = reader.policyFlow((Source.Unit) policy[0], (com.sun.source.tree.ClassTree) policy[1], (com.sun.source.tree.MethodTree) policy[2]);
            if (flow != null) {
                flows.add(flow);
            }
        }

        for (Domain.Aggregate aggregate : aggregates) {
            List<Object> operations = new ArrayList<>();
            for (Operations.UseCase useCase : useCases) {
                if (!belongs(useCase, aggregate)) {
                    continue;
                }
                List<String> by = exposed.get(useCase.id);
                if (by != null) {
                    by.sort(String::compareTo);
                }
                operations.add(Catalog.operation(useCase.id, useCase.kind, useCase.doc, by));
            }
            aggregate.object.put("operations", operations);

            Map<String, Object> lifecycle = Lifecycle.read(aggregate, events, b);
            if (lifecycle != null) {
                aggregate.object.put("lifecycle", lifecycle);
            }

            for (Object event : (List<?>) aggregate.object.get("events")) {
                String id = String.valueOf(((Map<?, ?>) event).get("id"));
                if (!reader.referenced.contains(id)) {
                    b.warn(id, "no flow reaches this event: nothing this extractor could follow publishes it");
                }
            }
        }

        String readme = Files.isRegularFile(root.resolve("README.md")) ? Files.readString(root.resolve("README.md")).strip() : "";

        Map<String, Object> serviceObject = Catalog.map(
                "id", svcId,
                "slug", service,
                "name", firstNonEmpty(opts.serviceName, readmeTitle(readme), Ids.title(service)),
                "repo", opts.repo.isEmpty() ? repo(root) : opts.repo,
                "path", rel.apply(root),
                "readme", readme,
                "provides", new ArrayList<>(),
                "consumes", reader.consumes(),
                "aggregates", aggregates.stream().map(a -> a.object).toList());

        Map<String, Object> contextObject = Catalog.map(
                "id", context,
                "slug", context,
                "name", opts.contextName.isEmpty() ? Ids.title(context) : opts.contextName,
                "summary", opts.contextSummary);
        if (!opts.classification.isEmpty()) {
            contextObject.put("classification", opts.classification);
        }
        contextObject.put("services", List.of(serviceObject));

        Map<String, Object> fragment = Catalog.map(
                "generatedAt", input.generatedAt(),
                "commit", input.commit(),
                "contexts", List.of(contextObject),
                "defs", Catalog.map(),
                "flows", flows,
                "adrs", new ArrayList<>());

        b.file(opts.out.isEmpty() ? "domain.json" : opts.out, Json.write(fragment) + "\n");
    }

    /** A use case belongs to the aggregate its package names, or to the only one there is. */
    private static boolean belongs(Operations.UseCase useCase, Domain.Aggregate aggregate) {
        if (useCase.aggregate.isEmpty()) {
            return false;
        }
        return useCase.aggregate.equals(aggregate.directory);
    }

    private static String readmeTitle(String markdown) {
        for (String line : markdown.split("\n")) {
            if (line.strip().startsWith("# ")) {
                return line.strip().substring(2).strip();
            }
        }
        return "";
    }

    /** The repository url from pom.xml's scm block, spelled the way go.mod spells a module. */
    private static String repo(Path root) throws IOException {
        Path pom = root.resolve("pom.xml");
        if (!Files.isRegularFile(pom)) {
            return "";
        }
        Matcher matcher = SCM.matcher(Files.readString(pom));
        if (!matcher.find()) {
            return "";
        }
        return matcher.group(1)
                .replaceFirst("^git\\+", "")
                .replaceFirst("^(https?|ssh)://", "")
                .replaceFirst("^git@", "")
                .replaceFirst("\\.git$", "")
                .replaceFirst("/$", "");
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.isEmpty()) {
                return value;
            }
        }
        return "";
    }
}
