package org.portolan.payments.ledger.domain.refund;

import java.util.List;
import java.util.Map;

/** A refund is asked for, and then it either goes back or it does not. */
public enum RefundStatus {
    REQUESTED,
    ISSUED,
    REJECTED;

    public static final Map<RefundStatus, List<RefundStatus>> TRANSITIONS = Map.of(
            REQUESTED, List.of(ISSUED, REJECTED),
            ISSUED, List.of(),
            REJECTED, List.of());
}
