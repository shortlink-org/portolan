package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * Where a payment's facts go once they are recorded. The domain hands one
 * over and stops caring; a bus, a log line or an outbox row is the adapter's
 * business.
 */
@SecondaryPort
public interface PaymentPublisher {

    void publish(Object event);
}
