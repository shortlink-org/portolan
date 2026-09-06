package org.portolan.payments.ledger.domain.payment;

/**
 * Why the money was not held, as a closed set.
 *
 * A consumer switches on this: an order hearing CARD_REFUSED asks the customer
 * for another card, one hearing ORDER_CANCELLED does nothing.
 */
public enum DeclineReason {
    /** The network would not hold the amount on this instrument. */
    CARD_REFUSED,
    /** The order was already cancelled when the hold was asked for; nothing was asked of the network. */
    ORDER_CANCELLED,
    /** The gateway did not answer in time. Retired: an outage now records nothing. */
    @Deprecated
    GATEWAY_TIMEOUT
}
