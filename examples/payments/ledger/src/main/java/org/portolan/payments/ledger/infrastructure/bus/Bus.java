package org.portolan.payments.ledger.infrastructure.bus;

/**
 * How an event leaves the service.
 *
 * The domain hands an event over and stops caring; what is behind this - NATS
 * when NATS_URL names a server, the log when it does not - is the assembly's
 * business and nothing above it knows the difference.
 */
public interface Bus {

    void publish(Object event);
}
