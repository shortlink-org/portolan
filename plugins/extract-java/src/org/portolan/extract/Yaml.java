package org.portolan.extract;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * As much YAML as an OpenAPI document written in block style uses, and no
 * more: mappings, sequences, plain and quoted scalars, block scalars, flow
 * lists, comments. The reader wants two things out of the document - `info`
 * and the operations under `paths` - and a JDK has no YAML parser, which is
 * the same reason {@link Json} exists.
 *
 * What it does not read, named so nobody discovers it: anchors and aliases,
 * tags, multi-document streams, flow mappings, multi-line quoted scalars. A
 * document that needs those is not one a generator wrote in block style, and
 * the shape of the failure is a route the reader cannot find, reported as
 * such.
 */
final class Yaml {

    private Yaml() {}

    static Object parse(String text) {
        return new Reader(text).document();
    }

    static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> map ? cast(map) : Map.of();
    }

    static List<Object> list(Object value) {
        return value instanceof List<?> list ? new ArrayList<>(list) : List.of();
    }

    static String string(Object value) {
        return value instanceof String s ? s : "";
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cast(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }

    /** One line of the source: how far it is indented, and what follows the indent. */
    private record Line(int indent, String text) {
        boolean blank() {
            return text.isEmpty();
        }

        boolean comment() {
            return text.startsWith("#");
        }

        boolean item() {
            return text.equals("-") || text.startsWith("- ");
        }
    }

    private static final class Reader {
        private final List<Line> lines = new ArrayList<>();
        private int at;

        Reader(String text) {
            for (String raw : text.split("\n", -1)) {
                String line = raw.stripTrailing();
                int indent = 0;
                while (indent < line.length() && line.charAt(indent) == ' ') {
                    indent++;
                }
                lines.add(new Line(indent, line.substring(indent)));
            }
        }

        Object document() {
            Line first = next();
            if (first == null) {
                return null;
            }
            return node(first.indent);
        }

        /** The next line that carries structure, or null at the end. Blank and comment lines are not structure. */
        private Line next() {
            while (at < lines.size()) {
                Line line = lines.get(at);
                if (!line.blank() && !line.comment()) {
                    return line;
                }
                at++;
            }
            return null;
        }

        private Object node(int indent) {
            Line line = next();
            if (line == null || line.indent < indent) {
                return null;
            }
            return line.item() ? sequence(line.indent) : mapping(line.indent);
        }

        /** The block nested under a key or an item at `indent`: whatever the next line starts, if it is deeper. */
        private Object nested(int indent) {
            Line line = next();
            if (line == null || line.indent <= indent) {
                return null;
            }
            return node(line.indent);
        }

        private Map<String, Object> mapping(int indent) {
            Map<String, Object> out = new LinkedHashMap<>();
            while (true) {
                Line line = next();
                if (line == null || line.indent != indent || line.item()) {
                    return out;
                }
                String[] entry = splitKey(line.text);
                if (entry == null) {
                    // Not `key: value`: a stray scalar where a mapping was expected. Skip it rather than loop on it.
                    at++;
                    continue;
                }
                String key = entry[0];
                String rest = entry[1];
                at++;
                if (rest.isEmpty()) {
                    out.put(key, nested(indent));
                } else if (rest.startsWith("|") || rest.startsWith(">")) {
                    out.put(key, block(indent, rest));
                } else {
                    out.put(key, scalar(rest));
                }
            }
        }

        private List<Object> sequence(int indent) {
            List<Object> out = new ArrayList<>();
            while (true) {
                Line line = next();
                if (line == null || line.indent != indent || !line.item()) {
                    return out;
                }
                String rest = line.text.equals("-") ? "" : line.text.substring(2).stripLeading();
                if (rest.isEmpty()) {
                    at++;
                    out.add(nested(indent));
                } else if (splitKey(rest) != null) {
                    // `- key: value` opens a mapping whose lines sit under the key, two columns in.
                    int inner = indent + (line.text.length() - rest.length());
                    lines.set(at, new Line(inner, rest));
                    out.add(mapping(inner));
                } else if (rest.startsWith("|") || rest.startsWith(">")) {
                    at++;
                    out.add(block(indent, rest));
                } else {
                    at++;
                    out.add(scalar(rest));
                }
            }
        }

        /** A block scalar: every following line deeper than the key, with the common indent removed. */
        private String block(int indent, String header) {
            boolean fold = header.startsWith(">");
            boolean strip = header.contains("-");
            List<Line> body = new ArrayList<>();
            while (at < lines.size()) {
                Line line = lines.get(at);
                if (!line.blank() && line.indent <= indent) {
                    break;
                }
                body.add(line);
                at++;
            }
            int common = Integer.MAX_VALUE;
            for (Line line : body) {
                if (!line.blank()) {
                    common = Math.min(common, line.indent);
                }
            }
            StringBuilder b = new StringBuilder();
            for (Line line : body) {
                String text = line.blank() ? "" : " ".repeat(line.indent - common) + line.text;
                if (fold && !b.isEmpty() && !text.isEmpty() && b.charAt(b.length() - 1) != '\n') {
                    b.append(' ');
                } else if (!b.isEmpty() && !fold) {
                    b.append('\n');
                } else if (fold && text.isEmpty()) {
                    b.append('\n');
                }
                b.append(text);
            }
            String text = b.toString();
            if (strip) {
                text = text.stripTrailing();
            } else if (!text.endsWith("\n")) {
                text = text + "\n";
            }
            return text;
        }

        /** `key: rest` split at the first colon that ends the key, or null when the line is not an entry. */
        private static String[] splitKey(String text) {
            int start = 0;
            String key;
            if (text.startsWith("'") || text.startsWith("\"")) {
                char quote = text.charAt(0);
                int end = text.indexOf(quote, 1);
                while (end > 0 && quote == '\'' && end + 1 < text.length() && text.charAt(end + 1) == '\'') {
                    end = text.indexOf(quote, end + 2);
                }
                if (end < 0) {
                    return null;
                }
                key = unquote(text.substring(0, end + 1));
                start = end + 1;
            } else {
                if (text.startsWith("[") || text.startsWith("{")) {
                    return null;
                }
                int colon = text.indexOf(": ");
                if (colon < 0) {
                    if (!text.endsWith(":")) {
                        return null;
                    }
                    colon = text.length() - 1;
                }
                key = text.substring(0, colon).strip();
                start = colon;
            }
            String after = text.substring(start).stripLeading();
            if (!after.startsWith(":")) {
                return null;
            }
            String rest = after.substring(1).strip();
            return new String[] {key, rest};
        }

        private static Object scalar(String text) {
            if (text.startsWith("'") || text.startsWith("\"")) {
                return unquote(text);
            }
            if (text.startsWith("[")) {
                List<Object> out = new ArrayList<>();
                String inner = text.substring(1, text.lastIndexOf(']') < 0 ? text.length() : text.lastIndexOf(']'));
                for (String part : inner.split(",")) {
                    String item = part.strip();
                    if (!item.isEmpty()) {
                        out.add(scalar(item));
                    }
                }
                return out;
            }
            if (text.equals("{}")) {
                return new LinkedHashMap<String, Object>();
            }
            int comment = text.indexOf(" #");
            if (comment >= 0) {
                text = text.substring(0, comment).strip();
            }
            return text;
        }

        private static String unquote(String text) {
            char quote = text.charAt(0);
            int end = text.lastIndexOf(quote);
            String inner = end > 0 ? text.substring(1, end) : text.substring(1);
            if (quote == '\'') {
                return inner.replace("''", "'");
            }
            return inner.replace("\\\"", "\"").replace("\\n", "\n").replace("\\\\", "\\");
        }
    }
}
