package org.portolan.payments.ledger.infrastructure.repository.payment;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PostingJpaRepository extends JpaRepository<PostingEntity, Long> {

    List<PostingEntity> findByPaymentIdOrderByIdAsc(String paymentId);
}
