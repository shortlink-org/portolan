package org.portolan.extract;

import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ModifiersTree;
import com.sun.source.tree.VariableTree;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What a Bean Validation annotation says a value must satisfy, in the
 * catalog's words.
 *
 * Java writes its constraints down: {@code @NotNull}, {@code @Size(min = 3, max = 3)},
 * {@code @Positive}, {@code @Pattern(regexp = "^[A-Z]{3}$")}. The catalog has
 * one vocabulary for these across every source (portolan.0015), so
 * {@code @Size(max = 64)} on a string is {@code max_len} here as
 * {@code maxLength} is in an OpenAPI document, {@code max_len} in a proto and
 * {@code max:64} in a Laravel rules array, and the page says all four the same
 * way.
 *
 * What a size bound means is decided by the type the field is declared with,
 * as Bean Validation decides it: on a {@code String} it is the length, on a
 * {@code List} the number of elements, on a {@code Map} the number of entries.
 *
 * Only the constraints are read. A Java field carries annotations about many
 * other things - {@code @Column}, {@code @JsonProperty}, {@code @Id} - and
 * keeping every unknown one as a rule, the way a proto's custom options are
 * kept, would bury what a caller must satisfy under what the wire and the
 * table want. Nothing is resolved here either (no classpath, as everywhere in
 * this plugin), so a constraint is known by its simple name: {@code @NotNull}
 * from {@code jakarta.validation}, {@code javax.validation} or anywhere else
 * reads the same, and a project's own {@code @ValidSku} is not read, since
 * nothing in the syntax says it is a constraint at all.
 */
final class Rules {

    private Rules() {}

    /** A field's rules, in the order they are written, and whether it must be given. */
    record Read(boolean required, List<Object> rules) {}

    /** What a size bound is about: a length, a number of items, a number of entries. */
    private enum Sized {
        TEXT("min_len", "max_len"),
        ITEMS("min_items", "max_items"),
        PAIRS("min_pairs", "max_pairs");

        final String min;
        final String max;

        Sized(String min, String max) {
            this.min = min;
            this.max = max;
        }
    }

    /** The constraints on a field or a record component, and on what it holds. */
    static Read of(VariableTree field) {
        return of(field.getModifiers(), field.getType().toString());
    }

    static Read of(ModifiersTree modifiers, String type) {
        boolean required = false;
        List<Object> rules = new ArrayList<>();
        Sized sized = sizedOf(type);
        for (AnnotationTree annotation : modifiers.getAnnotations()) {
            String name = Source.simple(annotation.getAnnotationType().toString());
            if (name.equals("NotNull") || name.equals("NotBlank") || name.equals("NotEmpty")) {
                required = true;
                if (!name.equals("NotNull")) {
                    // Not null, and holding something: a non-blank string is a
                    // character long, a non-empty list an element long.
                    rules.add(rule(sized == Sized.TEXT ? "min_len" : sized.min, "1"));
                }
                continue;
            }
            rules.addAll(rulesOf(name, annotation, sized));
        }
        // `List<@NotBlank String> tags`: what the elements must satisfy is
        // written inside the type, and the vocabulary has a prefix for it.
        for (Object held : Elements.of(type, sized)) {
            rules.add(held);
        }
        return new Read(required, rules);
    }

    /** The rules one constraint is, `@Size(min = 3, max = 3)` being two. */
    private static List<Object> rulesOf(String name, AnnotationTree annotation, Sized sized) {
        List<Object> out = new ArrayList<>();
        switch (name) {
            case "Size", "Length" -> {
                String min = Source.rawArgument(annotation, "min");
                String max = Source.rawArgument(annotation, "max");
                Sized about = name.equals("Length") ? Sized.TEXT : sized;
                if (!min.isEmpty()) {
                    out.add(rule(about.min, min));
                }
                if (!max.isEmpty()) {
                    out.add(rule(about.max, max));
                }
            }
            case "Range" -> {
                String min = Source.rawArgument(annotation, "min");
                String max = Source.rawArgument(annotation, "max");
                if (!min.isEmpty()) {
                    out.add(rule("gte", min));
                }
                if (!max.isEmpty()) {
                    out.add(rule("lte", max));
                }
            }
            case "Min" -> out.add(rule("gte", value(annotation)));
            case "Max" -> out.add(rule("lte", value(annotation)));
            // `inclusive = false` is what makes a decimal bound a strict one.
            case "DecimalMin" -> out.add(rule(inclusive(annotation) ? "gte" : "gt", value(annotation)));
            case "DecimalMax" -> out.add(rule(inclusive(annotation) ? "lte" : "lt", value(annotation)));
            case "Positive" -> out.add(rule("gt", "0"));
            case "PositiveOrZero" -> out.add(rule("gte", "0"));
            case "Negative" -> out.add(rule("lt", "0"));
            case "NegativeOrZero" -> out.add(rule("lte", "0"));
            case "Pattern" -> out.add(rule("pattern", Source.rawArgument(annotation, "regexp")));
            case "Email" -> {
                String regexp = Source.rawArgument(annotation, "regexp");
                out.add(rule("format", "email"));
                if (!regexp.isEmpty()) {
                    out.add(rule("pattern", regexp));
                }
            }
            case "URL" -> out.add(rule("format", "uri"));
            case "UUID" -> out.add(rule("format", "uuid"));
            case "Past", "PastOrPresent" -> out.add(rule("lt_now", ""));
            case "Future", "FutureOrPresent" -> out.add(rule("gt_now", ""));
            case "AssertTrue" -> out.add(rule("const", "true"));
            case "AssertFalse" -> out.add(rule("const", "false"));
            // A constraint the vocabulary has no word for is still a fact
            // about the field, and keeps the name Java gave it.
            case "Digits" -> out.add(rule("digits", digits(annotation)));
            case "CreditCardNumber", "ISBN", "EAN", "Currency", "LuhnCheck" -> out.add(rule(Ids.slug(name).replace('-', '_'), ""));
            default -> {
                // Everything else on a Java field is about the wire, the
                // table or the framework, and is not a rule.
            }
        }
        return out;
    }

    /** `@Size` on what: a string's length, a collection's size, a map's entries. */
    private static Sized sizedOf(String type) {
        String bare = Source.simple(type);
        if (bare.equals("Map") || bare.endsWith("Map")) {
            return Sized.PAIRS;
        }
        if (type.endsWith("[]")
                || bare.equals("List")
                || bare.equals("Set")
                || bare.equals("Collection")
                || bare.equals("Iterable")
                || bare.endsWith("List")
                || bare.endsWith("Set")) {
            return Sized.ITEMS;
        }
        return Sized.TEXT;
    }

    /** The constraints written inside a generic type, on what the container holds. */
    private static final class Elements {
        static List<Object> of(String type, Sized sized) {
            List<Object> out = new ArrayList<>();
            int open = type.indexOf('<');
            if (open < 0 || !type.endsWith(">")) {
                return out;
            }
            List<String> arguments = split(type.substring(open + 1, type.length() - 1));
            for (int i = 0; i < arguments.size(); i++) {
                // A map's first argument is its keys and the second its values;
                // anything else holds one thing, which the vocabulary calls its
                // items.
                String prefix = sized == Sized.PAIRS ? (i == 0 ? "keys" : "values") : "items";
                for (Object rule : Written.of(arguments.get(i), prefix)) {
                    out.add(rule);
                }
            }
            return out;
        }

        /** Type arguments, at the top level of the angle brackets. */
        static List<String> split(String arguments) {
            List<String> out = new ArrayList<>();
            int depth = 0;
            StringBuilder current = new StringBuilder();
            for (char c : arguments.toCharArray()) {
                if (c == '<') {
                    depth++;
                } else if (c == '>') {
                    depth--;
                } else if (c == ',' && depth == 0) {
                    out.add(current.toString().strip());
                    current.setLength(0);
                    continue;
                }
                current.append(c);
            }
            if (!current.isEmpty()) {
                out.add(current.toString().strip());
            }
            return out;
        }
    }

    /**
     * The constraints written on a type argument, which javac hands back as
     * text - `@NotBlank String`, `@Size(max = 8) String` - since nothing here
     * is resolved. Read by the same names, under the prefix the container
     * gives them.
     */
    private static final class Written {
        static List<Object> of(String argument, String prefix) {
            List<Object> out = new ArrayList<>();
            for (String[] found : annotations(argument)) {
                String name = found[0];
                String arguments = found[1];
                if (name.equals("NotNull") || name.equals("NotBlank") || name.equals("NotEmpty")) {
                    out.add(rule(prefix + ".required", ""));
                    if (!name.equals("NotNull")) {
                        out.add(rule(prefix + ".min_len", "1"));
                    }
                    continue;
                }
                for (Object stated : simple(name, arguments)) {
                    Map<?, ?> as = (Map<?, ?>) stated;
                    Object value = as.get("value");
                    out.add(rule(prefix + "." + as.get("name"), value == null ? "" : String.valueOf(value)));
                }
            }
            return out;
        }

        /** The constraints of the annotation text, as `{name, arguments}`. */
        static List<String[]> annotations(String argument) {
            List<String[]> out = new ArrayList<>();
            int at = argument.indexOf('@');
            while (at >= 0) {
                int end = at + 1;
                while (end < argument.length() && (Character.isJavaIdentifierPart(argument.charAt(end)) || argument.charAt(end) == '.')) {
                    end++;
                }
                String name = Source.simple(argument.substring(at + 1, end));
                String arguments = "";
                if (end < argument.length() && argument.charAt(end) == '(') {
                    int close = argument.indexOf(')', end);
                    if (close > 0) {
                        arguments = argument.substring(end + 1, close);
                        end = close + 1;
                    }
                }
                out.add(new String[] {name, arguments});
                at = argument.indexOf('@', end);
            }
            return out;
        }

        /** The bounds an annotation's text states, for the few that take arguments. */
        static List<Object> simple(String name, String arguments) {
            List<Object> out = new ArrayList<>();
            switch (name) {
                case "Size", "Length" -> {
                    String min = written(arguments, "min");
                    String max = written(arguments, "max");
                    if (!min.isEmpty()) {
                        out.add(rule("min_len", min));
                    }
                    if (!max.isEmpty()) {
                        out.add(rule("max_len", max));
                    }
                }
                case "Min" -> out.add(rule("gte", written(arguments, "value")));
                case "Max" -> out.add(rule("lte", written(arguments, "value")));
                case "Positive" -> out.add(rule("gt", "0"));
                case "PositiveOrZero" -> out.add(rule("gte", "0"));
                case "Negative" -> out.add(rule("lt", "0"));
                case "NegativeOrZero" -> out.add(rule("lte", "0"));
                case "Pattern" -> out.add(rule("pattern", unquote(written(arguments, "regexp"))));
                case "Email" -> out.add(rule("format", "email"));
                case "URL" -> out.add(rule("format", "uri"));
                case "UUID" -> out.add(rule("format", "uuid"));
                default -> {
                    // As on a field: what is not a constraint is not a rule.
                }
            }
            return out;
        }

        static String written(String arguments, String name) {
            for (String part : arguments.split(",")) {
                String one = part.strip();
                int eq = one.indexOf('=');
                if (eq < 0) {
                    if (name.equals("value")) {
                        return one;
                    }
                    continue;
                }
                if (one.substring(0, eq).strip().equals(name)) {
                    return one.substring(eq + 1).strip();
                }
            }
            return "";
        }

        static String unquote(String text) {
            return text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"") ? text.substring(1, text.length() - 1) : text;
        }
    }

    private static String value(AnnotationTree annotation) {
        return Source.rawArgument(annotation, "value");
    }

    /** `@DecimalMin(value = "1.00", inclusive = false)`: inclusive unless it says otherwise. */
    private static boolean inclusive(AnnotationTree annotation) {
        return !Source.rawArgument(annotation, "inclusive").equals("false");
    }

    private static String digits(AnnotationTree annotation) {
        String integer = Source.rawArgument(annotation, "integer");
        String fraction = Source.rawArgument(annotation, "fraction");
        if (integer.isEmpty() && fraction.isEmpty()) {
            return "";
        }
        return "integer " + (integer.isEmpty() ? "0" : integer) + ", fraction " + (fraction.isEmpty() ? "0" : fraction);
    }

    /**
     * The type without the constraints written into it: `List<@NotBlank String>`
     * is a `List<String>`, and what the elements must satisfy is a rule rather
     * than part of the name of the type.
     */
    static String bareType(String type) {
        if (type.indexOf('@') < 0) {
            return type;
        }
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < type.length()) {
            char c = type.charAt(i);
            if (c != '@') {
                out.append(c);
                i++;
                continue;
            }
            i++;
            while (i < type.length() && (Character.isJavaIdentifierPart(type.charAt(i)) || type.charAt(i) == '.')) {
                i++;
            }
            if (i < type.length() && type.charAt(i) == '(') {
                int depth = 0;
                while (i < type.length()) {
                    char at = type.charAt(i);
                    if (at == '(') {
                        depth++;
                    } else if (at == ')') {
                        depth--;
                        if (depth == 0) {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
            }
            while (i < type.length() && type.charAt(i) == ' ') {
                i++;
            }
        }
        return out.toString().strip();
    }

    /** One rule, with its bound when it has one. */
    static Map<String, Object> rule(String name, String value) {
        return value == null || value.isEmpty() ? Catalog.map("name", name) : Catalog.map("name", name, "value", value);
    }
}
