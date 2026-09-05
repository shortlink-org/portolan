package org.portolan.payments.ledger.infrastructure.stripe;

/** Stripe could not be reached, or did not answer in time. The HTTP client's word for it; the gateway adapter translates. */
public final class StripeUnavailable extends RuntimeException {

    public StripeUnavailable(String what, Throwable cause) {
        super(what, cause);
    }
}
