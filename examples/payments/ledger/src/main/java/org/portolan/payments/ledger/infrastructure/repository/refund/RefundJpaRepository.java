package org.portolan.payments.ledger.infrastructure.repository.refund;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RefundJpaRepository extends JpaRepository<RefundEntity, String> {

    List<RefundEntity> findByPaymentIdOrderBySettledAtDesc(String paymentId);
}
