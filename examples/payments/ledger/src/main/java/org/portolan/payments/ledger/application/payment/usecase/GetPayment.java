package org.portolan.payments.ledger.application.payment.usecase;

import java.util.Optional;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.payment.usecase.dto.PaymentView;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;

/**
 * Reads one payment, for whoever is asking what happened to the money.
 *
 * A query: it answers with what the caller may see and never lends the
 * aggregate. The answer is as of the last commit; the read goes to the
 * payment's own table.
 */
@Service
public class GetPayment {

    private final PaymentRepository payments;

    public GetPayment(PaymentRepository payments) {
        this.payments = payments;
    }

    public Optional<PaymentView> handle(String paymentId) {
        return payments.byId(paymentId).map(GetPayment::view);
    }

    private static PaymentView view(Payment payment) {
        return new PaymentView(
                payment.id(),
                payment.orderId(),
                payment.amount(),
                payment.status(),
                payment.attempt(),
                payment.createdAt());
    }
}
