package org.portolan.payments.ledger.infrastructure.bus;

/** How an event leaves the service. What is behind it is the assembly's business. */
public interface Bus {

    void publish(Object event);
}
