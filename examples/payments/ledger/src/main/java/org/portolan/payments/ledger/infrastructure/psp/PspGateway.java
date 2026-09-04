package org.portolan.payments.ledger.infrastructure.psp;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;

import org.portolan.payments.ledger.domain.payment.PaymentGateway;

/**
 * The card network, over its own HTTP API.
 *
 * No contract is vendored beside this file and no service in the estate
 * provides one: the far end is a third party. So every call through here is
 * recorded and left unresolved, which is the honest answer to "who answers
 * this" rather than a peer invented to make the arrow land somewhere.
 */
@SecondaryAdapter
public class PspGateway implements PaymentGateway {

    private final PspHttpClient http;

    public PspGateway(PspHttpClient http) {
        this.http = http;
    }

    @Override
    public String reserve(String orderId, long amountMinor, String currency) {
        return http.post("/v2/charges", "{\"order\":\"" + orderId + "\",\"amount\":" + amountMinor + ",\"currency\":\"" + currency + "\"}");
    }

    @Override
    public void settle(String authCode) {
        http.post("/v2/charges/" + authCode + "/capture", "{}");
    }

    @Override
    public void release(String authCode) {
        http.delete("/v2/charges/" + authCode);
    }

    @Override
    public String giveBack(String authCode, long amountMinor) {
        return http.post("/v2/charges/" + authCode + "/refunds", "{\"amount\":" + amountMinor + "}");
    }
}
