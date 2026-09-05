package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.architecture.hexagonal.SecondaryPort;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The card network, in this service's words: hold the money, capture it, void
 * the hold, refund what was captured. What is behind it is somebody else's
 * system and somebody else's uptime, and its own words for these four things
 * stay in the adapter.
 *
 * Every method either answers or throws {@link GatewayUnavailable}. A refusal
 * is an answer; not being reachable is not.
 */
@SecondaryPort
public interface PaymentGateway {

    Hold hold(String orderId, Money amount);

    void capture(String authCode);

    void voidHold(String authCode);

    Giveback refund(String authCode, Money amount);
}
