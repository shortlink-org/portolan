package org.portolan.payments.ledger.infrastructure.bus;

import java.nio.charset.StandardCharsets;

import io.nats.client.Connection;
import io.nats.client.impl.Headers;

/**
 * Events out, over NATS.
 *
 * The subject is the channel the event names, and its wire name travels in the
 * headers - so a subscriber dispatches without parsing the payload, which is
 * the same bargain the other services on this bus made.
 */
public class NatsBus implements Bus {

    private final Connection nats;

    public NatsBus(Connection nats) {
        this.nats = nats;
    }

    @Override
    public void publish(Object event) {
        Headers headers = new Headers();
        headers.add("Event-Name", name(event));
        nats.publish(channel(event), headers, payload(event));
    }

    /** The NAME constant of the event, which is what it is called on the wire. */
    private static String name(Object event) {
        return constant(event, "NAME");
    }

    /** The CHANNEL constant: the subject it goes out on. */
    private static String channel(Object event) {
        return constant(event, "CHANNEL");
    }

    private static String constant(Object event, String field) {
        try {
            return String.valueOf(event.getClass().getField(field).get(null));
        } catch (ReflectiveOperationException absent) {
            throw new IllegalStateException(event.getClass().getSimpleName() + " declares no " + field + ", so nothing says where it goes", absent);
        }
    }

    private static byte[] payload(Object event) {
        return event.toString().getBytes(StandardCharsets.UTF_8);
    }
}
