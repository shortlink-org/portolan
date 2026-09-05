package org.portolan.payments.ledger.infrastructure.transport.grpc;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.portolan.payments.ledger.domain.payment.AttemptTaken;
import org.portolan.payments.ledger.domain.payment.GatewayUnavailable;
import org.portolan.payments.ledger.domain.payment.IllegalMove;
import org.portolan.payments.ledger.domain.payment.NoSuchPayment;
import org.portolan.payments.ledger.domain.refund.NotRefundable;

/**
 * The one place a domain error becomes a status. What a caller may act on is
 * named; anything else is INTERNAL and says nothing more, because a storage
 * or gateway detail on the wire is a detail somebody will build on.
 */
public final class Statuses {

    private Statuses() {}

    public static StatusRuntimeException of(RuntimeException failure) {
        if (failure instanceof NoSuchPayment) {
            return Status.NOT_FOUND.withDescription(failure.getMessage()).asRuntimeException();
        }
        if (failure instanceof IllegalMove || failure instanceof NotRefundable) {
            return Status.FAILED_PRECONDITION.withDescription(failure.getMessage()).asRuntimeException();
        }
        if (failure instanceof AttemptTaken) {
            return Status.ABORTED.withDescription(failure.getMessage()).asRuntimeException();
        }
        if (failure instanceof GatewayUnavailable) {
            return Status.UNAVAILABLE.withDescription("the payment gateway did not answer; nothing was recorded").asRuntimeException();
        }
        return Status.INTERNAL.withDescription("the ledger could not read or write").asRuntimeException();
    }
}
