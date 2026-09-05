package org.portolan.payments.ledger.infrastructure.psp;

/** The network could not be reached, or did not answer in time. The HTTP client's word for it; the gateway adapter translates. */
public final class PspUnavailable extends RuntimeException {

    public PspUnavailable(String what, Throwable cause) {
        super(what, cause);
    }
}
