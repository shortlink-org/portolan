package org.portolan.payments.ledger.domain.refund;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/** Where a refund's facts go once they are recorded. */
@SecondaryPort
public interface RefundPublisher {

    void publish(Object event);
}
