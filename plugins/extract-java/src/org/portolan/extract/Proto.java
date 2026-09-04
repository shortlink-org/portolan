package org.portolan.extract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The contract beside a handler or a client, read for its names.
 *
 * Only the names: the package, the services and their rpcs, which is all that
 * is needed to say which endpoint answers which rpc and what a call is known by
 * in the catalog. The shapes belong to {@code extract-proto}, which reads the
 * same files properly and puts them in the module.
 */
final class Proto {

    private static final Pattern PACKAGE = Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");
    private static final Pattern SERVICE = Pattern.compile("(?s)service\\s+(\\w+)\\s*\\{(.*?)\\n\\}");
    private static final Pattern RPC = Pattern.compile("rpc\\s+(\\w+)\\s*\\(\\s*(?:stream\\s+)?([\\w.]+)\\s*\\)\\s*returns\\s*\\(\\s*(?:stream\\s+)?([\\w.]+)\\s*\\)");

    record Rpc(String name, String request, String response) {}

    record Service(String pkg, String name, List<Rpc> rpcs, String source) {
        /** The id the catalog knows this interface by: package and service. */
        String id() {
            return pkg.isEmpty() ? name : pkg + "." + name;
        }
    }

    private Proto() {}

    /** Every service declared by the .proto files under a directory. */
    static List<Service> under(Path directory, java.util.function.Function<Path, String> rel) throws IOException {
        List<Service> out = new ArrayList<>();
        if (!Files.isDirectory(directory)) {
            return out;
        }
        List<Path> files;
        try (var walk = Files.walk(directory)) {
            files = walk.filter(Files::isRegularFile).filter(p -> p.toString().endsWith(".proto")).sorted().toList();
        }
        for (Path file : files) {
            String text = Files.readString(file);
            Matcher pkg = PACKAGE.matcher(text);
            String name = pkg.find() ? pkg.group(1) : "";
            Matcher service = SERVICE.matcher(text);
            while (service.find()) {
                List<Rpc> rpcs = new ArrayList<>();
                Matcher rpc = RPC.matcher(service.group(2));
                while (rpc.find()) {
                    rpcs.add(new Rpc(rpc.group(1), rpc.group(2), rpc.group(3)));
                }
                out.add(new Service(name, service.group(1), rpcs, rel.apply(file)));
            }
        }
        return out;
    }

    /** `getOrder` and `GetOrder` are one name; the proto's spelling wins. */
    static boolean sameName(String method, String rpc) {
        return method.equalsIgnoreCase(rpc);
    }
}
