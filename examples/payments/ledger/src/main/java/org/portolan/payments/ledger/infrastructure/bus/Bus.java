package org.portolan.payments.ledger.infrastructure.bus;

import org.portolan.payments.ledger.domain.payment.PaymentPublisher;
import org.portolan.payments.ledger.domain.refund.RefundPublisher;

/**
 * How an event leaves the service: both domains' Publisher ports, satisfied
 * by one thing. NATS when a server is named, the log when none is; the
 * domain cannot tell, and that is the point.
 */
public interface Bus extends PaymentPublisher, RefundPublisher {
}
