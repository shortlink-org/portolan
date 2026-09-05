package org.portolan.payments.ledger.infrastructure.bus;

/** The two constants every event declares: what it is called on the wire, and the subject it goes out on. */
final class Wire {

    private Wire() {}

    static String name(Object event) {
        return constant(event, "NAME");
    }

    static String channel(Object event) {
        return constant(event, "CHANNEL");
    }

    private static String constant(Object event, String field) {
        try {
            return String.valueOf(event.getClass().getField(field).get(null));
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(event.getClass().getSimpleName() + " declares no " + field + ", so nothing says where it goes", absent);
        }
    }
}
