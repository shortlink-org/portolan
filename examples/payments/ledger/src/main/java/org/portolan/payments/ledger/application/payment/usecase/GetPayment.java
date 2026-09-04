package org.portolan.payments.ledger.application.payment.usecase;

import java.util.Optional;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;

/** Reads one payment, for whoever is asking what happened to the money. */
@Service
public class GetPayment {

    private final PaymentRepository payments;

    public GetPayment(PaymentRepository payments) {
        this.payments = payments;
    }

    public Optional<Payment> handle(String paymentId) {
        return payments.byId(paymentId);
    }
}
