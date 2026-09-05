package org.portolan.extract;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The plugin protocol, as {@code plugin/protocol.go} spells it: one JSON
 * request on stdin, one JSON response on stdout, and a {@code describe} that
 * answers with what the plugin is and what it can be told.
 *
 * Nothing here reads the environment or the clock. Every fact about the estate
 * arrives in the request, which is what lets the same tree produce the same
 * fragment on any machine.
 */
final class Protocol {

    private Protocol() {}

    /** Where the source is, and the stamp the host put on this run. */
    record Input(String root, String commit, String generatedAt) {
        static Input of(Object raw) {
            Map<String, Object> map = Json.object(raw);
            return new Input(
                    Json.string(map.get("root")),
                    Json.string(map.get("commit")),
                    Json.string(map.get("generatedAt")));
        }
    }

    /**
     * What the manifest tells the extractor: the things a Java service does not
     * say about the estate it belongs to.
     *
     * An option the plugin does not know is refused rather than dropped, the way
     * {@code deny_unknown_fields} refuses one in the Rust extractor: an option
     * nobody reads is a page that comes out blank with nothing saying why.
     */
    static final class Options {
        String context = "";
        String contextName = "";
        String contextSummary = "";
        String classification = "";
        String service = "";
        String serviceName = "";
        String repo = "";
        String store = "";
        String source = "src/main/java";
        String out = "domain.json";
        Map<String, String> peers = new LinkedHashMap<>();
        Map<String, String> events = new LinkedHashMap<>();

        static Options of(Object raw) {
            Options opts = new Options();
            for (Map.Entry<String, Object> e : Json.object(raw).entrySet()) {
                switch (e.getKey()) {
                    case "context" -> opts.context = Json.string(e.getValue());
                    case "contextName" -> opts.contextName = Json.string(e.getValue());
                    case "contextSummary" -> opts.contextSummary = Json.string(e.getValue());
                    case "classification" -> opts.classification = Json.string(e.getValue());
                    case "service" -> opts.service = Json.string(e.getValue());
                    case "serviceName" -> opts.serviceName = Json.string(e.getValue());
                    case "repo" -> opts.repo = Json.string(e.getValue());
                    case "store" -> opts.store = Json.string(e.getValue());
                    case "source" -> opts.source = Json.string(e.getValue());
                    case "out" -> opts.out = Json.string(e.getValue());
                    case "peers" -> opts.peers = strings(e.getValue());
                    case "events" -> opts.events = strings(e.getValue());
                    default -> throw new IllegalArgumentException("unknown option " + e.getKey());
                }
            }
            return opts;
        }

        private static Map<String, String> strings(Object raw) {
            Map<String, String> out = new LinkedHashMap<>();
            Json.object(raw).forEach((key, value) -> out.put(key, Json.string(value)));
            return out;
        }
    }

    /** Collects files and internal extraction warnings. Warnings are not wire data. */
    static final class Builder {
        private final List<Map<String, Object>> files = new ArrayList<>();
        private final List<Map<String, Object>> warnings = new ArrayList<>();

        void file(String name, String contents) {
            files.add(Catalog.map("name", name, "contents", contents));
        }

        void warn(String ref, String message) {
            warnings.add(Catalog.map("severity", "warning", "message", message, "ref", ref));
        }

        Map<String, Object> response() {
            return Catalog.map("files", files);
        }

        List<Map<String, Object>> warnings() { return warnings; }
    }
}
