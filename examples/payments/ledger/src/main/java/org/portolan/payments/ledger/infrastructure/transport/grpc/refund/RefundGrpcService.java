package org.portolan.payments.ledger.infrastructure.transport.grpc.refund;

import io.grpc.stub.StreamObserver;
import net.devh.boot.grpc.server.service.GrpcService;

import org.portolan.payments.ledger.application.refund.usecase.IssueRefund;
import org.portolan.payments.ledger.application.refund.usecase.ListRefunds;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.IssueRefundRequest;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.IssueRefundResponse;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.ListRefundsRequest;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.ListRefundsResponse;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.RefundServiceGrpc;
import org.portolan.payments.ledger.infrastructure.transport.grpc.refund.gen.RefundView;

/** The way in for money going back: one method per rpc of payments.v1.RefundService. */
@GrpcService
public class RefundGrpcService extends RefundServiceGrpc.RefundServiceImplBase {

    private final IssueRefund issueRefund;
    private final ListRefunds listRefunds;

    public RefundGrpcService(IssueRefund issueRefund, ListRefunds listRefunds) {
        this.issueRefund = issueRefund;
        this.listRefunds = listRefunds;
    }

    /** Sends money back against a captured payment. */
    @Override
    public void issueRefund(IssueRefundRequest request, StreamObserver<IssueRefundResponse> observer) {
        var event = issueRefund.handle(
                request.getRefundId(),
                request.getPaymentId(),
                new Money(request.getAmountMinor(), request.getCurrency()),
                request.getReason());
        observer.onNext(IssueRefundResponse.newBuilder()
                .setRefundId(request.getRefundId())
                .setIssued(event != null)
                .build());
        observer.onCompleted();
    }

    /** Every refund against one payment. */
    @Override
    public void listRefunds(ListRefundsRequest request, StreamObserver<ListRefundsResponse> observer) {
        var refunds = listRefunds.handle(request.getPaymentId());
        var response = ListRefundsResponse.newBuilder();
        for (var refund : refunds) {
            response.addRefunds(RefundView.newBuilder()
                    .setRefundId(refund.id())
                    .setAmountMinor(refund.amount().amountMinor())
                    .setCurrency(refund.amount().currency())
                    .setStatus(refund.status().name())
                    .build());
        }
        observer.onNext(response.build());
        observer.onCompleted();
    }
}
