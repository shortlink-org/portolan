package org.portolan.extract;

/**
 * How a name in the source becomes an id in the catalog.
 *
 * These are the rules {@code extract-go} lives by and every other extractor
 * repeats, spelled the same a fifth time, so a Java service and a Go service
 * with the same aggregate get the same id.
 */
final class Ids {

    private Ids() {}

    /** PriceList -&gt; price-list, Address -&gt; address, ID -&gt; id. */
    static String slug(String name) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            boolean upper = c >= 'A' && c <= 'Z';
            if (upper && i > 0) {
                char prev = name.charAt(i - 1);
                char next = i + 1 < name.length() ? name.charAt(i + 1) : '\0';
                if ((prev >= 'a' && prev <= 'z') || (next >= 'a' && next <= 'z')) {
                    out.append('-');
                }
            }
            char r = upper ? Character.toLowerCase(c) : c;
            out.append(r == '_' || r == '.' ? '-' : r);
        }
        return out.toString().replaceAll("-+", "-").replaceAll("^-|-$", "");
    }

    /** authorize_payment -&gt; AuthorizePayment: the operation id a name becomes. */
    static String camel(String name) {
        StringBuilder out = new StringBuilder();
        for (String word : name.split("[_\\-]+")) {
            if (!word.isEmpty()) {
                out.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
            }
        }
        return out.toString();
    }

    /** price_list -&gt; Price List: the human name for a directory. */
    static String title(String name) {
        StringBuilder out = new StringBuilder();
        for (String word : name.split("[_\\-]+")) {
            if (word.isEmpty()) {
                continue;
            }
            if (out.length() > 0) {
                out.append(' ');
            }
            out.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
        }
        return out.toString();
    }

    /** A directory name in PascalCase, which is what its root class is called. */
    static String pascal(String name) {
        return camel(name);
    }

    static String serviceId(String context, String service) {
        return context + "." + service;
    }

    static String aggregateId(String service, String aggregate) {
        return service + "." + aggregate;
    }

    static String blockId(String aggregate, String block) {
        return aggregate + "." + block;
    }

    static String eventId(String aggregate, String name) {
        return aggregate + "." + name;
    }
}
