package org.portolan.extract;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.VariableTree;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The model, read where Java says what it is.
 *
 * Java is the first language in this estate with a vocabulary for the model:
 * jMolecules writes {@code @AggregateRoot}, {@code @Entity}, {@code @ValueObject}
 * and {@code @Repository} into the source, so the role of a class is declared
 * rather than inferred. Where the annotations are absent the layout answers
 * instead - a package under {@code domain} whose class is named after it - and
 * that is said in a diagnostic, because a guess and a claim should not read the
 * same on the page.
 */
final class Domain {

    /** One aggregate, and the catalog object being built from it. */
    static final class Aggregate {
        final String pkg;               // ...domain.payment
        final String directory;         // the last segment: payment
        Source.Unit rootUnit;
        ClassTree root;
        final List<ClassTree> entities = new ArrayList<>();
        final List<Map.Entry<Source.Unit, ClassTree>> valueObjects = new ArrayList<>();
        final List<ClassTree> ports = new ArrayList<>();
        final Map<String, Source.Unit> unitOf = new LinkedHashMap<>();
        Map<String, Object> object;
        boolean declared;               // the root said so itself

        Aggregate(String pkg) {
            this.pkg = pkg;
            this.directory = pkg.substring(pkg.lastIndexOf('.') + 1);
        }

        String id() {
            return String.valueOf(object.get("id"));
        }

        String slug() {
            return String.valueOf(object.get("slug"));
        }

        Source.Unit unit(ClassTree type) {
            return unitOf.get(type.getSimpleName().toString());
        }
    }

    private Domain() {}

    static List<Aggregate> read(Source.Project project, String serviceId, Path root, Protocol.Builder b) {
        Map<String, Aggregate> byPackage = new LinkedHashMap<>();

        for (Source.Unit unit : project.units) {
            String pkg = aggregatePackage(unit.packageName);
            if (pkg == null) {
                continue;
            }
            Aggregate aggregate = byPackage.computeIfAbsent(pkg, Aggregate::new);
            for (ClassTree type : unit.classes()) {
                aggregate.unitOf.put(type.getSimpleName().toString(), unit);
                classify(aggregate, unit, type);
            }
        }

        List<Aggregate> out = new ArrayList<>();
        for (Aggregate aggregate : byPackage.values()) {
            if (aggregate.root == null) {
                b.warn(serviceId, aggregate.pkg + " is a domain package with no aggregate root: annotate one with @AggregateRoot, or name it after the package");
                continue;
            }
            if (!aggregate.declared) {
                b.warn(
                        aggregate.rootUnit.rel,
                        aggregate.root.getSimpleName() + " is read as the root because it is named after its package; @AggregateRoot would say so outright");
            }
            build(aggregate, serviceId);
            out.add(aggregate);
        }
        return out;
    }

    /** `…domain.payment` for a class of an aggregate, null for anything else. */
    private static String aggregatePackage(String pkg) {
        int at = pkg.indexOf(".domain.");
        if (at < 0) {
            return null;
        }
        String rest = pkg.substring(at + ".domain.".length());
        int cut = rest.indexOf('.');
        String aggregate = cut < 0 ? rest : rest.substring(0, cut);
        return aggregate.isEmpty() ? null : pkg.substring(0, at + ".domain.".length()) + aggregate;
    }

    private static void classify(Aggregate aggregate, Source.Unit unit, ClassTree type) {
        var modifiers = type.getModifiers();
        String name = type.getSimpleName().toString();

        if (Source.annotated(modifiers, "AggregateRoot")) {
            aggregate.root = type;
            aggregate.rootUnit = unit;
            aggregate.declared = true;
            return;
        }
        if (Source.annotated(modifiers, "ValueObject")) {
            aggregate.valueObjects.add(Map.entry(unit, type));
            return;
        }
        if (Source.annotated(modifiers, "Entity")) {
            aggregate.entities.add(type);
            return;
        }
        if (Source.annotated(modifiers, "DomainEvent")) {
            return; // events are read by Events, not here
        }
        if (Source.isInterface(type)) {
            // A port: the domain declaring what it needs from outside.
            aggregate.ports.add(type);
            return;
        }
        if (Source.isEnum(type)) {
            return; // a closed set of values, read by Lifecycle when it is the status
        }
        // Nothing said what this is. The layout answers: the class named after
        // the package is the root, anything else beside it is an entity.
        if (name.equals(Ids.pascal(aggregate.directory)) && aggregate.root == null) {
            aggregate.root = type;
            aggregate.rootUnit = unit;
            return;
        }
        if (!unit.packageName.endsWith(".event") && !unit.packageName.endsWith(".events")) {
            aggregate.entities.add(type);
        }
    }

    private static void build(Aggregate aggregate, String serviceId) {
        String name = aggregate.root.getSimpleName().toString();
        String slug = Ids.slug(name);
        String id = Ids.aggregateId(serviceId, slug);
        Source.Unit unit = aggregate.rootUnit;

        aggregate.object = Catalog.aggregate(id, slug, name, unit.doc(aggregate.root), name);

        List<Object> entities = new ArrayList<>();
        entities.add(block(id, unit, aggregate.root));
        for (ClassTree entity : aggregate.entities) {
            entities.add(block(id, aggregate.unit(entity), entity));
        }
        aggregate.object.put("entities", entities);

        List<Object> values = new ArrayList<>();
        for (var value : aggregate.valueObjects) {
            values.add(block(id, value.getKey(), value.getValue()));
        }
        aggregate.object.put("valueObjects", values);
    }

    private static Map<String, Object> block(String aggregateId, Source.Unit unit, ClassTree type) {
        String name = type.getSimpleName().toString();
        return Catalog.block(
                Ids.blockId(aggregateId, Ids.slug(name)),
                Ids.slug(name),
                name,
                unit.doc(type),
                fields(unit, type));
    }

    /** The fields of a class, or the components of a record, with the type as written. */
    static List<Object> fields(Source.Unit unit, ClassTree type) {
        List<Object> out = new ArrayList<>();
        if (Source.isRecord(type)) {
            for (var component : type.getMembers()) {
                if (component instanceof VariableTree field && field.getModifiers().getFlags().isEmpty()) {
                    out.add(Catalog.field(field.getName().toString(), field.getType().toString(), unit.doc(field)));
                }
            }
            if (!out.isEmpty()) {
                return out;
            }
        }
        for (VariableTree field : Source.fields(type)) {
            out.add(Catalog.field(field.getName().toString(), field.getType().toString(), unit.doc(field)));
        }
        return out;
    }
}
