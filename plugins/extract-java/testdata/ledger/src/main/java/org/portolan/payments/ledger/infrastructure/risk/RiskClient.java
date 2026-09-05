package org.portolan.payments.ledger.infrastructure.risk;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.application.payment.usecase.Risk;

/**
 * A risk service somebody else runs, with no contract vendored beside this
 * file: its methods are the calls, and every one of them stays unresolved
 * until a document says what answers.
 */
@SecondaryAdapter
public class RiskClient implements Risk {

    @Override
    public boolean allows(String orderId) {
        return true;
    }
}
