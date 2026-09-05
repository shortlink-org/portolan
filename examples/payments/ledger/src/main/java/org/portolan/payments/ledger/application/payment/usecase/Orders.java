package org.portolan.payments.ledger.application.payment.usecase;

/**
 * What authorising needs of the order service, declared by the only use case
 * that asks: does the order still stand. No line of the payment domain asks an
 * order anything, so the port is here and not there; the adapter over the
 * generated client fills it at assembly.
 */
public interface Orders {

    /** A closed set. A status this service does not know is an error in the adapter, never a default here. */
    enum Standing {
        LIVE,
        CANCELLED
    }

    Standing standing(String orderId);
}
