package org.portolan.payments.ledger.infrastructure.repository.payment;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.domain.payment.AttemptTaken;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.Posting;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The port over Spring Data: the one place that knows both the row and the
 * model, and the only one allowed to.
 *
 * A save is one transaction: the payment's row and every posting it has grown
 * go together or neither does, because a capture whose postings did not land is
 * money the ledger cannot account for. Postings are append-only, so a save
 * writes the ones the row does not have yet and never the ones it does: the
 * same payment saved twice has the same journal.
 */
@SecondaryAdapter
@Component
public class PaymentRepositoryAdapter implements PaymentRepository {

    /** The constraint payments.0004 asks for; its name is how the refusal is told apart from any other. */
    static final String ATTEMPT_KEY = "payments_order_attempt_key";

    private final PaymentJpaRepository payments;
    private final PostingJpaRepository postings;

    public PaymentRepositoryAdapter(PaymentJpaRepository payments, PostingJpaRepository postings) {
        this.payments = payments;
        this.postings = postings;
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
        try {
            payments.saveAndFlush(new PaymentEntity(
                    payment.id(),
                    payment.orderId(),
                    payment.attempt(),
                    payment.amount().amountMinor(),
                    payment.amount().currency(),
                    payment.status().name(),
                    payment.authCode(),
                    payment.createdAt()));
        } catch (DataIntegrityViolationException violation) {
            if (String.valueOf(violation.getMostSpecificCause().getMessage()).contains(ATTEMPT_KEY)) {
                throw new AttemptTaken(payment.orderId(), payment.attempt());
            }
            throw violation;
        }
        int held = postings.findByPaymentIdOrderByIdAsc(payment.id()).size();
        List<Posting> grown = payment.postings();
        List<PostingEntity> rows = new ArrayList<>();
        for (Posting posting : grown.subList(Math.min(held, grown.size()), grown.size())) {
            rows.add(new PostingEntity(
                    payment.id(),
                    posting.account(),
                    posting.amount().amountMinor(),
                    posting.amount().currency(),
                    posting.writtenAt()));
        }
        postings.saveAll(rows);
    }

    private Payment toDomain(PaymentEntity row) {
        List<Posting> held = new ArrayList<>();
        for (PostingEntity posting : postings.findByPaymentIdOrderByIdAsc(row.id())) {
            held.add(new Posting(posting.account(), new Money(posting.amountMinor(), posting.currency()), posting.writtenAt()));
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
