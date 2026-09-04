package org.portolan.payments.ledger.domain.refund;

import java.util.List;
import java.util.Optional;

import org.jmolecules.ddd.annotation.Repository;

/** Where refunds are kept. */
@Repository
public interface RefundRepository {

    Optional<Refund> byId(String id);

    List<Refund> byPayment(String paymentId);

    void save(Refund refund);
}
