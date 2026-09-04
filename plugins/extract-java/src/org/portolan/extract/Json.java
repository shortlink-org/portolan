package org.portolan.extract;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JSON, both ways, in as little code as the protocol needs.
 *
 * The JDK ships no JSON API, and a plugin that pulled one in would need a build
 * system to fetch it - which is the whole cost this extractor is avoiding. What
 * is read here is one request the host wrote; what is written is one fragment
 * this plugin composed. Neither is arbitrary text off the internet, so the
 * reader is strict and small: it accepts what it understands and refuses the
 * rest rather than guessing.
 *
 * Order is preserved on the way out, because a fragment is reviewed as a diff.
 */
final class Json {

    private Json() {}

    // --- reading ------------------------------------------------------------

    static Object parse(String text) {
        Reader reader = new Reader(text);
        reader.skipSpace();
        Object value = reader.value();
        reader.skipSpace();
        if (!reader.done()) {
            throw new IllegalArgumentException("trailing text at " + reader.at);
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }

    @SuppressWarnings("unchecked")
    static List<Object> array(Object value) {
        return value instanceof List ? (List<Object>) value : List.of();
    }

    static String string(Object value) {
        return value instanceof String s ? s : "";
    }

    private static final class Reader {
        private final String text;
        private int at;

        Reader(String text) {
            this.text = text;
        }

        boolean done() {
            return at >= text.length();
        }

        void skipSpace() {
            while (at < text.length() && Character.isWhitespace(text.charAt(at))) {
                at++;
            }
        }

        Object value() {
            skipSpace();
            if (done()) {
                throw new IllegalArgumentException("nothing to read at " + at);
            }
            char c = text.charAt(at);
            return switch (c) {
                case '{' -> map();
                case '[' -> list();
                case '"' -> string();
                case 't', 'f' -> bool();
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        Map<String, Object> map() {
            Map<String, Object> out = new LinkedHashMap<>();
            expect('{');
            skipSpace();
            if (peek() == '}') {
                at++;
                return out;
            }
            while (true) {
                skipSpace();
                String key = string();
                skipSpace();
                expect(':');
                out.put(key, value());
                skipSpace();
                char c = next();
                if (c == '}') {
                    return out;
                }
                if (c != ',') {
                    throw new IllegalArgumentException("expected , or } at " + at);
                }
            }
        }

        List<Object> list() {
            List<Object> out = new ArrayList<>();
            expect('[');
            skipSpace();
            if (peek() == ']') {
                at++;
                return out;
            }
            while (true) {
                out.add(value());
                skipSpace();
                char c = next();
                if (c == ']') {
                    return out;
                }
                if (c != ',') {
                    throw new IllegalArgumentException("expected , or ] at " + at);
                }
            }
        }

        String string() {
            expect('"');
            StringBuilder b = new StringBuilder();
            while (true) {
                char c = next();
                if (c == '"') {
                    return b.toString();
                }
                if (c != '\\') {
                    b.append(c);
                    continue;
                }
                char escape = next();
                switch (escape) {
                    case '"', '\\', '/' -> b.append(escape);
                    case 'b' -> b.append('\b');
                    case 'f' -> b.append('\f');
                    case 'n' -> b.append('\n');
                    case 'r' -> b.append('\r');
                    case 't' -> b.append('\t');
                    case 'u' -> {
                        b.append((char) Integer.parseInt(text.substring(at, at + 4), 16));
                        at += 4;
                    }
                    default -> throw new IllegalArgumentException("unknown escape \\" + escape);
                }
            }
        }

        Object bool() {
            return peek() == 't' ? literal("true", Boolean.TRUE) : literal("false", Boolean.FALSE);
        }

        Object literal(String word, Object value) {
            if (!text.startsWith(word, at)) {
                throw new IllegalArgumentException("expected " + word + " at " + at);
            }
            at += word.length();
            return value;
        }

        Object number() {
            int start = at;
            while (at < text.length() && "+-.eE0123456789".indexOf(text.charAt(at)) >= 0) {
                at++;
            }
            if (start == at) {
                throw new IllegalArgumentException("not a value at " + at);
            }
            return Double.valueOf(text.substring(start, at));
        }

        char peek() {
            return at < text.length() ? text.charAt(at) : '\0';
        }

        char next() {
            if (done()) {
                throw new IllegalArgumentException("ended early");
            }
            return text.charAt(at++);
        }

        void expect(char c) {
            if (next() != c) {
                throw new IllegalArgumentException("expected " + c + " at " + (at - 1));
            }
        }
    }

    // --- writing ------------------------------------------------------------

    /** Two-space indent and insertion order, the way every other plugin writes a fragment. */
    static String write(Object value) {
        StringBuilder b = new StringBuilder();
        write(value, b, 0);
        return b.toString();
    }

    private static void write(Object value, StringBuilder b, int depth) {
        switch (value) {
            case null -> b.append("null");
            case String s -> quote(s, b);
            case Boolean bool -> b.append(bool);
            case Integer i -> b.append(i);
            case Long l -> b.append(l);
            case Double d -> b.append(d == Math.floor(d) && !d.isInfinite() ? String.valueOf(d.longValue()) : d.toString());
            case Map<?, ?> map -> {
                if (map.isEmpty()) {
                    b.append("{}");
                    return;
                }
                b.append("{\n");
                int i = 0;
                for (Map.Entry<?, ?> e : map.entrySet()) {
                    indent(b, depth + 1);
                    quote(String.valueOf(e.getKey()), b);
                    b.append(": ");
                    write(e.getValue(), b, depth + 1);
                    if (++i < map.size()) {
                        b.append(',');
                    }
                    b.append('\n');
                }
                indent(b, depth);
                b.append('}');
            }
            case List<?> list -> {
                if (list.isEmpty()) {
                    b.append("[]");
                    return;
                }
                b.append("[\n");
                for (int i = 0; i < list.size(); i++) {
                    indent(b, depth + 1);
                    write(list.get(i), b, depth + 1);
                    if (i + 1 < list.size()) {
                        b.append(',');
                    }
                    b.append('\n');
                }
                indent(b, depth);
                b.append(']');
            }
            default -> quote(String.valueOf(value), b);
        }
    }

    private static void indent(StringBuilder b, int depth) {
        b.append("  ".repeat(depth));
    }

    private static void quote(String s, StringBuilder b) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        b.append('"');
    }
}
