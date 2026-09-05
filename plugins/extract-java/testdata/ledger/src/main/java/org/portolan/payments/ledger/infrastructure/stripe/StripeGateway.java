package org.portolan.payments.ledger.infrastructure.stripe;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;

/**
 * Stripe, over its own HTTP API.
 *
 * Nobody in this estate provides it, and it is not pretended to: the copy of
 * Stripe's document vendored beside this file says which operation each route
 * below lands on, and the manifest says the far end is outside the estate.
 */
@SecondaryAdapter
public class StripeGateway implements PaymentGateway {

    private final StripeHttpClient http;

    public StripeGateway(StripeHttpClient http) {
        this.http = http;
    }

    @Override
    public String reserve(String orderId, long amountMinor, String currency) {
        return http.post("/v1/payment_intents", "amount=" + amountMinor + "&currency=" + currency + "&capture_method=manual&confirm=true");
    }

    @Override
    public void settle(String authCode) {
        http.post("/v1/payment_intents/" + authCode + "/capture", "");
    }
}
