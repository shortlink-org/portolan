package org.portolan.payments.ledger.domain.payment;

import java.util.Optional;

import org.jmolecules.ddd.annotation.Repository;

/** Where payments are kept. The port whose other end is this service's own database. */
@Repository
public interface PaymentRepository {

    Optional<Payment> byId(String id);

    Optional<Payment> byOrder(String orderId);

    void save(Payment payment);
}
