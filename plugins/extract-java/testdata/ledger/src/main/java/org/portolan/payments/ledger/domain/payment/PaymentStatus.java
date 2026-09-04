package org.portolan.payments.ledger.domain.payment;

import java.util.List;
import java.util.Map;

/**
 * Where a payment is in its life, and the one way through those states.
 *
 * The table is the claim and the methods of the root are held to it: an edge
 * nothing makes and a move into a state that is not here are both reported.
 */
public enum PaymentStatus {
    PENDING,
    AUTHORIZED,
    CAPTURED,
    DECLINED,
    VOIDED;

    public static final Map<PaymentStatus, List<PaymentStatus>> TRANSITIONS = Map.of(
            PENDING, List.of(AUTHORIZED, DECLINED),
            AUTHORIZED, List.of(CAPTURED, VOIDED),
            CAPTURED, List.of(),
            DECLINED, List.of(),
            VOIDED, List.of());
}
