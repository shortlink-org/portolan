package org.portolan.extract;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * portolan-extract-java: a Java service in, a catalog fragment out.
 *
 * The same protocol as every other extractor: one JSON request on stdin, one
 * JSON response on stdout, and a {@code describe} that answers with what the
 * plugin is and what it can be told. A JDK and nothing else - the parser is
 * javac's own, and a plugin that needed the service's dependencies could not be
 * run over somebody else's checkout.
 */
public final class Main {

    private Main() {}

    public static void main(String[] args) {
        try {
            System.out.print(serve(read(System.in)));
        } catch (Exception failure) {
            System.err.println("portolan-extract-java: " + failure.getMessage());
            System.exit(1);
        }
    }

    static String serve(String raw) throws IOException {
        Map<String, Object> request = Json.object(Json.parse(raw));
        if ("describe".equals(Json.string(request.get("kind")))) {
            return Json.write(Catalog.map("files", List.of(), "diagnostics", List.of(), "describe", descriptor()));
        }
        Protocol.Input input = Protocol.Input.of(request.get("input"));
        if (input.root().isEmpty()) {
            throw new IllegalArgumentException("no input root: an extractor has nothing to read");
        }
        Protocol.Builder b = new Protocol.Builder();
        Extract.run(input, Protocol.Options.of(request.get("options")), b, Path.of("").toAbsolutePath());
        return Json.write(b.response());
    }

    static Map<String, Object> descriptor() throws IOException {
        return Catalog.map(
                "name", "extract-java",
                "summary", "Reads a Java service by what it declares - jMolecules aggregates, events and ports, Spring's listeners and handlers - into a catalog fragment.",
                "phases", List.of("extract"),
                "options", Json.parse(Files.readString(options())));
    }

    /** The options schema, beside the source rather than inside the classes. */
    static Path options() {
        Path beside = Path.of("plugins/extract-java/options.schema.json");
        if (Files.isRegularFile(beside)) {
            return beside;
        }
        return Path.of(System.getProperty("portolan.options", "options.schema.json"));
    }

    private static String read(InputStream in) throws IOException {
        return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
}
