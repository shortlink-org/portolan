package org.portolan.payments.ledger.infrastructure.stripe;

/** Whatever HTTP client Stripe is spoken to with. */
public interface StripeHttpClient {

    String post(String path, String form);
}
