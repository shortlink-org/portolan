package org.portolan.payments.ledger.infrastructure.psp;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;

/**
 * The card network, over its own HTTP API.
 *
 * Nobody in this estate provides it and no contract is vendored beside this
 * file, because the far end is a third party: the calls are recorded and left
 * unresolved, which is the honest answer to "who answers this".
 */
@SecondaryAdapter
public class PspGateway implements PaymentGateway {

    private final PspHttpClient http;

    public PspGateway(PspHttpClient http) {
        this.http = http;
    }

    @Override
    public String reserve(String orderId, long amountMinor, String currency) {
        return http.post("/v2/charges", orderId, amountMinor, currency);
    }

    @Override
    public void settle(String authCode) {
        http.post("/v2/charges/" + authCode + "/capture", authCode, 0, "");
    }
}
