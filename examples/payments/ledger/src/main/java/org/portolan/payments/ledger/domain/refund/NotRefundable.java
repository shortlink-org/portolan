package org.portolan.payments.ledger.domain.refund;

/**
 * The refund was asked for against money that cannot go back: none was
 * captured, or more was asked than is left. One sentinel, the reason a
 * closed set, because the caller acts differently on each.
 */
public final class NotRefundable extends RuntimeException {

    public enum Why {
        NOT_CAPTURED,
        EXCEEDS_BALANCE
    }

    private final Why why;

    public NotRefundable(Why why) {
        super(switch (why) {
            case NOT_CAPTURED -> "nothing was captured, so nothing can go back";
            case EXCEEDS_BALANCE -> "more was asked back than is left of the capture";
        });
        this.why = why;
    }

    public Why why() {
        return why;
    }
}
