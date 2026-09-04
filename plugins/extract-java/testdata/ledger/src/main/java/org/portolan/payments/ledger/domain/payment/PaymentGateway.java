package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/** The card network, as the domain needs it: reserve, move, give back. */
@SecondaryPort
public interface PaymentGateway {

    String reserve(String orderId, long amountMinor, String currency);

    void settle(String authCode);
}
