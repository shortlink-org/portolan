package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.VariableTree;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the service publishes.
 *
 * A class saying {@code @DomainEvent} is one, wherever it sits; a class in the
 * aggregate's {@code event} package is one too, because that is where a project
 * without jMolecules puts them. The wire name is the {@code NAME} constant and
 * the channel the {@code CHANNEL} constant - the two facts a bus needs, written
 * in the domain rather than in a config nobody reads beside it.
 */
final class Events {

    /** An event, found by the name the code calls it. */
    record Found(String name, String id, Source.Unit unit) {}

    private Events() {}

    static Map<String, Found> read(Domain.Aggregate aggregate, String service, Protocol.Builder b) {
        List<Object> events = new ArrayList<>();
        Map<String, Found> found = new LinkedHashMap<>();

        for (Map.Entry<String, Source.Unit> entry : aggregate.unitOf.entrySet()) {
            Source.Unit unit = entry.getValue();
            for (ClassTree type : unit.classes()) {
                if (!isEvent(unit, type)) {
                    continue;
                }
                String name = type.getSimpleName().toString();
                String id = Ids.eventId(aggregate.id(), name);
                String wireName = constant(type, "NAME");
                String channel = constant(type, "CHANNEL");
                if (wireName.isEmpty()) {
                    wireName = service + "." + name;
                    b.warn(id, "no NAME constant, so the name on the wire is assumed to be " + wireName);
                }
                Map<String, Object> wire = Catalog.map("name", wireName);
                if (!channel.isEmpty()) {
                    wire.put("channel", channel);
                }
                events.add(Catalog.event(
                        id,
                        Ids.slug(name),
                        name,
                        List.of(Catalog.version(unit.doc(type), unit.rel, Domain.fields(unit, type))),
                        wire));
                found.put(name, new Found(name, id, unit));
            }
        }

        events.sort(Comparator.comparing(e -> String.valueOf(((Map<?, ?>) e).get("id"))));
        aggregate.object.put("events", events);
        return found;
    }

    static boolean isEvent(Source.Unit unit, ClassTree type) {
        return Source.annotated(type.getModifiers(), "DomainEvent")
                || unit.packageName.endsWith(".event")
                || unit.packageName.endsWith(".events");
    }

    /** A string constant of a class, as written. */
    static String constant(ClassTree type, String name) {
        for (VariableTree field : Source.constants(type)) {
            if (field.getName().contentEquals(name) && field.getInitializer() != null) {
                return Source.literal(field.getInitializer().toString());
            }
        }
        return "";
    }
}
