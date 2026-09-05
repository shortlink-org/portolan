package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/** Where a payment's facts go once they are recorded. A port of the domain; the bus behind it is the assembly's business. */
@SecondaryPort
public interface Publisher {

    void publish(Object event);
}
