package org.portolan.payments.ledger.infrastructure.repository.refund;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.springframework.stereotype.Component;

import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.domain.refund.RefundStatus;

/** The refund port over Spring Data. */
@SecondaryAdapter
@Component
public class RefundRepositoryAdapter implements RefundRepository {

    private final RefundJpaRepository refunds;
    private final Clock clock;

    public RefundRepositoryAdapter(RefundJpaRepository refunds, Clock clock) {
        this.refunds = refunds;
        this.clock = clock;
    }

    @Override
    public Optional<Refund> byId(String id) {
        return refunds.findById(id).map(this::toDomain);
    }

    @Override
    public List<Refund> byPayment(String paymentId) {
        List<Refund> out = new ArrayList<>();
        for (RefundEntity row : refunds.findByPaymentIdOrderBySettledAtDesc(paymentId)) {
            out.add(toDomain(row));
        }
        return out;
    }

    @Override
    public void save(Refund refund) {
        refunds.save(new RefundEntity(
                refund.id(),
                refund.paymentId(),
                refund.orderId(),
                refund.amount().amountMinor(),
                refund.amount().currency(),
                refund.reason(),
                refund.status().name(),
                refund.settledAt()));
    }

    private Refund toDomain(RefundEntity row) {
        Refund refund = new Refund(row.id(), row.paymentId(), row.orderId(), new Money(row.amountMinor(), row.currency()), row.reason());
        if (RefundStatus.valueOf(row.status()) == RefundStatus.ISSUED) {
            refund.issue(Instant.now(clock));
        }
        return refund;
    }
}
