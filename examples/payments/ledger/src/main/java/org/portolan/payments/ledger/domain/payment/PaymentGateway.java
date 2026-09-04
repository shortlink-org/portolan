package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * The card network, as the domain needs it: hold the money, move it, give it
 * back. What is behind it is somebody else's system and somebody else's uptime.
 */
@SecondaryPort
public interface PaymentGateway {

    String reserve(String orderId, long amountMinor, String currency);

    void settle(String authCode);

    void release(String authCode);

    String giveBack(String authCode, long amountMinor);
}
