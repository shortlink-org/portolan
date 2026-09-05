package org.portolan.payments.ledger.infrastructure.stripe;

import java.util.Map;

/**
 * The HTTP Stripe is spoken to with: a form-encoded POST, the way its API
 * takes every request. Nothing above infrastructure sees it.
 *
 * An answer is a status and a body, whatever the status; not getting one at
 * all is {@link StripeUnavailable}. The two are different facts and the caller
 * is not left to tell them apart from an empty string.
 */
public interface StripeHttpClient {

    record Response(int status, String body) {

        public boolean ok() {
            return status / 100 == 2;
        }

        /** 402 is how Stripe says the card said no: a decision, and a recordable one. */
        public boolean declined() {
            return status == 402;
        }
    }

    Response post(String path, Map<String, String> form);
}
