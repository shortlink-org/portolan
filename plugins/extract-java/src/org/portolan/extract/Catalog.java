package org.portolan.extract;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The shapes of a fragment, in the order {@code catalog/model.go} declares them.
 *
 * A mirror, not a second definition: {@code src/catalog.ts} is where the shape
 * is decided. Building the JSON here rather than at each call site is what
 * keeps the key order - and so the diff of a regenerated fragment - stable.
 */
final class Catalog {

    static final String DECLARED = "declared";
    static final String UNRESOLVED = "unresolved";

    private Catalog() {}

    /** An ordered map from alternating keys and values. */
    static Map<String, Object> map(Object... pairs) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            out.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return out;
    }

    static Map<String, Object> field(String name, String type, String doc) {
        return map("name", name, "type", type, "doc", doc);
    }

    static Map<String, Object> block(String id, String slug, String name, String doc, List<Object> fields) {
        return map("id", id, "slug", slug, "name", name, "doc", doc, "fields", fields);
    }

    static Map<String, Object> version(String doc, String source, List<Object> fields) {
        return map("version", "v1", "doc", doc, "source", source, "fields", fields);
    }

    static Map<String, Object> event(String id, String slug, String name, List<Object> versions, Map<String, Object> wire) {
        Map<String, Object> out = map("id", id, "slug", slug, "name", name, "versions", versions, "consumers", new ArrayList<>());
        if (wire != null) {
            out.put("wire", wire);
        }
        return out;
    }

    static Map<String, Object> operation(String id, String kind, String doc, List<String> exposedBy) {
        Map<String, Object> out = map("id", id, "kind", kind);
        if (!doc.isEmpty()) {
            out.put("doc", doc);
        }
        if (exposedBy != null && !exposedBy.isEmpty()) {
            out.put("exposedBy", exposedBy);
        }
        return out;
    }

    static Map<String, Object> aggregate(String id, String slug, String name, String readme, String root) {
        return map(
                "id", id,
                "slug", slug,
                "name", name,
                "readme", readme,
                "root", root,
                "entities", new ArrayList<>(),
                "valueObjects", new ArrayList<>(),
                "operations", new ArrayList<>(),
                "events", new ArrayList<>());
    }

    static Map<String, Object> transition(String from, String to, String on, String emits, String source) {
        Map<String, Object> out = map("from", from, "to", to, "on", on);
        if (!emits.isEmpty()) {
            out.put("emits", emits);
        }
        if (!source.isEmpty()) {
            out.put("source", source);
        }
        return out;
    }

    static Map<String, Object> rpcCall(String id, String peer, String status, String source) {
        return map("id", id, "peer", peer, "status", status, "source", source);
    }

    static Map<String, Object> participant(String id, String kind, String context, String label) {
        Map<String, Object> out = map("id", id, "kind", kind, "context", context);
        if (!label.isEmpty()) {
            out.put("label", label);
        }
        return out;
    }

    static Map<String, Object> step(String id, String from, String to, String kind, String label, String status, String ref, String note, String line) {
        Map<String, Object> out = map("type", "step", "id", id, "from", from, "to", to, "kind", kind);
        if (!label.isEmpty()) {
            out.put("label", label);
        }
        out.put("status", status);
        if (!ref.isEmpty()) {
            out.put("ref", ref);
        }
        if (!note.isEmpty()) {
            out.put("note", note);
        }
        if (!line.isEmpty()) {
            out.put("line", line);
        }
        return out;
    }

    static Map<String, Object> alt(String id, List<Object> branches) {
        return map("type", "alt", "id", id, "branches", branches);
    }

    static Map<String, Object> branch(String title, List<Object> steps, boolean terminal) {
        Map<String, Object> out = map("title", title, "steps", steps);
        if (terminal) {
            out.put("terminal", Boolean.TRUE);
        }
        return out;
    }

    static Map<String, Object> flow(String id, String slug, String name, String summary, String source, String owner, List<Object> participants, List<Object> steps) {
        return map(
                "id", id,
                "slug", slug,
                "name", name,
                "summary", summary,
                "source", source,
                "owner", owner,
                "participants", participants,
                "steps", steps);
    }
}
