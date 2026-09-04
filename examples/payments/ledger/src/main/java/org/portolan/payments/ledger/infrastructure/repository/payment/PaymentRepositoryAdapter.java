package org.portolan.payments.ledger.infrastructure.repository.payment;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.Posting;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The port over Spring Data: the one place that knows both the row and the
 * model, and the only one allowed to.
 *
 * A save is one transaction: the payment's row and every posting it has grown
 * go together or neither does, because a capture whose postings did not land is
 * money the ledger cannot account for.
 */
@SecondaryAdapter
@Component
public class PaymentRepositoryAdapter implements PaymentRepository {

    private final PaymentJpaRepository payments;
    private final PostingJpaRepository postings;
    private final Clock clock;

    public PaymentRepositoryAdapter(PaymentJpaRepository payments, PostingJpaRepository postings, Clock clock) {
        this.payments = payments;
        this.postings = postings;
        this.clock = clock;
    }

    @Override
    public Optional<Payment> byId(String id) {
        return payments.findById(id).map(this::toDomain);
    }

    @Override
    public Optional<Payment> byOrder(String orderId) {
        return payments.findFirstByOrderIdOrderByAttemptDesc(orderId).map(this::toDomain);
    }

    @Override
    @Transactional
    public void save(Payment payment) {
        payments.save(new PaymentEntity(
                payment.id(),
                payment.orderId(),
                payment.attempt(),
                payment.amount().amountMinor(),
                payment.amount().currency(),
                payment.status().name(),
                payment.authCode(),
                payment.createdAt()));
        List<PostingEntity> rows = new ArrayList<>();
        for (Posting posting : payment.postings()) {
            rows.add(new PostingEntity(
                    payment.id(),
                    posting.account(),
                    posting.amount().amountMinor(),
                    posting.amount().currency(),
                    Instant.parse(posting.writtenAt())));
        }
        postings.saveAll(rows);
    }

    private Payment toDomain(PaymentEntity row) {
        List<Posting> held = new ArrayList<>();
        for (PostingEntity posting : postings.findByPaymentIdOrderByIdAsc(row.id())) {
            held.add(new Posting(posting.account(), new Money(posting.amountMinor(), posting.currency()), posting.writtenAt().toString()));
        }
        return Payment.restore(
                row.id(),
                row.orderId(),
                new Money(row.amountMinor(), row.currency()),
                row.attempt(),
                row.createdAt(),
                PaymentStatus.valueOf(row.status()),
                row.authCode(),
                held);
    }
}
