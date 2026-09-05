package org.portolan.extract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The OpenAPI document beside an HTTP client, read for its names: which api it
 * is, and which operation answers on which route. The same rules as
 * {@code plugins/openapi} in Go and {@code extract-ts}'s openapi.ts, so a call
 * read here and a method read there share one id - {@code auth.v1.Sessions/login}
 * - and the shapes belong to {@code extract-openapi}, which reads the same
 * file properly.
 */
final class OpenApi {

    static final List<String> VERBS = List.of("get", "put", "post", "delete", "options", "head", "patch", "trace");

    /** One route of the document and the name it goes by. */
    record Operation(String id, String tag, String verb, String path) {}

    /** The part of a document these extractors read. */
    record Spec(String api, List<Operation> operations, String source) {

        /** An operation by verb and route. Parameters are compared by position, not by name: `{userId}`, `{}` and `%s` are one marker. */
        Operation find(String verb, String path) {
            String want = verb.toUpperCase() + " " + shape(path);
            for (Operation op : operations) {
                if ((op.verb() + " " + shape(op.path())).equals(want)) {
                    return op;
                }
            }
            return null;
        }

        /** What a call to the operation is known by in the catalog. */
        String callId(Operation op) {
            return interfaceId(api, op.tag()) + "/" + op.id();
        }
    }

    private OpenApi() {}

    /** Every document vendored under a directory - `openapi/openapi.yaml` beside the adapter, wherever exactly it sits. */
    static List<Spec> under(Path directory, java.util.function.Function<Path, String> rel) throws IOException {
        List<Spec> out = new ArrayList<>();
        if (!Files.isDirectory(directory)) {
            return out;
        }
        List<Path> files;
        try (var walk = Files.walk(directory)) {
            files = walk.filter(Files::isRegularFile)
                    .filter(p -> {
                        String name = p.getFileName().toString();
                        return name.equals("openapi.yaml") || name.equals("openapi.yml") || name.equals("swagger.yaml") || name.equals("swagger.yml");
                    })
                    .sorted()
                    .toList();
        }
        for (Path file : files) {
            out.add(read(file, rel.apply(file)));
        }
        return out;
    }

    static Spec read(Path file, String source) throws IOException {
        Map<String, Object> doc = Yaml.map(Yaml.parse(Files.readString(file)));
        Map<String, Object> info = Yaml.map(doc.get("info"));
        String api = documentApiId(Yaml.string(info.get("x-portolan-api")), Yaml.string(info.get("title")), Yaml.string(info.get("version")));
        List<Operation> operations = new ArrayList<>();
        for (Map.Entry<String, Object> route : Yaml.map(doc.get("paths")).entrySet()) {
            Map<String, Object> item = Yaml.map(route.getValue());
            for (String verb : VERBS) {
                Object raw = item.get(verb);
                if (raw == null) {
                    continue;
                }
                Map<String, Object> operation = Yaml.map(raw);
                String id = Yaml.string(operation.get("operationId"));
                if (id.isEmpty()) {
                    id = verb.toUpperCase() + " " + route.getKey();
                }
                List<Object> tags = Yaml.list(operation.get("tags"));
                String tag = tags.isEmpty() ? "" : Yaml.string(tags.get(0));
                operations.add(new Operation(id, tag, verb.toUpperCase(), route.getKey()));
            }
        }
        return new Spec(api, operations, source);
    }

    /** `auth` 1.0.0 gives `auth.v1`. */
    static String apiId(String title, String version) {
        String name = (title.isEmpty() ? "api" : title).toLowerCase().replace(" ", "-");
        int dot = version.indexOf('.');
        String major = dot < 0 ? version : version.substring(0, dot);
        return major.isEmpty() ? name : name + ".v" + major;
    }

    /** The id the document says it goes by in the estate - `x-portolan-api`, for a copy vendored from outside - or the one built from its title and version. */
    static String documentApiId(String declared, String title, String version) {
        String named = declared.strip();
        return named.isEmpty() ? apiId(title, version) : named;
    }

    /** users becomes Users, price_list becomes PriceList. */
    static String title(String name) {
        StringBuilder b = new StringBuilder();
        for (String word : name.split("[_\\- ]+")) {
            if (word.isEmpty()) {
                continue;
            }
            char first = word.charAt(0);
            b.append(first >= 'a' && first <= 'z' ? Character.toUpperCase(first) : first).append(word.substring(1));
        }
        return b.toString();
    }

    static String interfaceId(String api, String tag) {
        return tag.isEmpty() ? api : api + "." + title(tag);
    }

    /** Every parameter, however spelled, becomes one marker. */
    static String shape(String path) {
        StringBuilder b = new StringBuilder();
        String trimmed = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
        for (String segment : trimmed.split("/", -1)) {
            if (segment.startsWith("{") || segment.equals("%s") || segment.equals("%v") || segment.equals("%d")) {
                b.append("/*");
            } else {
                b.append('/').append(segment);
            }
        }
        return b.toString();
    }
}
