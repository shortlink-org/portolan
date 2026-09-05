package org.portolan.payments.ledger.infrastructure.bus;

import io.nats.client.Connection;

/**
 * The connection to the bus, or none. One bean rather than an optional one,
 * so the publisher and the subscriber are told the same thing at assembly and
 * neither has to guess from a property.
 */
public record NatsLink(Connection connection) {

    public static NatsLink none() {
        return new NatsLink(null);
    }

    public boolean connected() {
        return connection != null;
    }
}
