package org.portolan.payments.ledger.domain.payment;

/**
 * Why the money was not held, as a closed set.
 *
 * A consumer switches on this: an order hearing CARD_REFUSED asks the customer
 * for another card, one hearing ORDER_CANCELLED does nothing, because it was
 * the one that cancelled. Free text from a third party is not something to
 * switch on, so the gateway's own words never get this far.
 */
public enum DeclineReason {
    /** The network would not hold the amount on this instrument. */
    CARD_REFUSED,
    /**
     * The order was cancelled: before the hold was asked for, and nothing was
     * asked of the network, or before the hold was recorded, and the hold was
     * given back (ledger.0005).
     */
    ORDER_CANCELLED
}
