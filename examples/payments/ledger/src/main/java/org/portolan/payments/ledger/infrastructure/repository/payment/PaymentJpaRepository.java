package org.portolan.payments.ledger.infrastructure.repository.payment;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

/** Spring Data's half: rows in, rows out, and nothing about the model. */
public interface PaymentJpaRepository extends JpaRepository<PaymentEntity, String> {

    Optional<PaymentEntity> findFirstByOrderIdOrderByAttemptDesc(String orderId);
}
