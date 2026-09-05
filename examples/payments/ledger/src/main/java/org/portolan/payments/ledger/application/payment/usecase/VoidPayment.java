package org.portolan.payments.ledger.application.payment.usecase;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.payment.usecase.dto.VoidOutput;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;

/**
 * Gives back a hold nobody is going to be charged for.
 *
 * Idempotent, because the fact that asks for it arrives at least once: an
 * order with nothing held, or with a hold already gone, is answered with
 * "nothing released" and nothing is asked of the gateway. Captured money is
 * not touched here; sending it back is the refund aggregate's business.
 */
@Service
public class VoidPayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;

    public VoidPayment(PaymentRepository payments, PaymentGateway gateway) {
        this.payments = payments;
        this.gateway = gateway;
    }

    public VoidOutput handle(String orderId) {
        var held = payments.byOrder(orderId);
        if (held.isEmpty() || held.get().status() != PaymentStatus.AUTHORIZED) {
            return new VoidOutput(orderId, false);
        }
        var payment = held.get();
        payment.voidAuthorization();       // the table allows AUTHORIZED -> VOIDED and nothing else
        gateway.voidHold(payment.authCode());
        payments.save(payment);
        return new VoidOutput(orderId, true);
    }
}
