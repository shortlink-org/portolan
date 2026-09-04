package org.portolan.payments.ledger.infrastructure.transport.grpc.payment;

import net.devh.boot.grpc.server.service.GrpcService;
import io.grpc.stub.StreamObserver;

import org.portolan.payments.ledger.application.payment.usecase.AuthorizePayment;
import org.portolan.payments.ledger.application.payment.usecase.CapturePayment;
import org.portolan.payments.ledger.application.payment.usecase.GetPayment;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.PaymentServiceGrpc;

/** The way in: the rpcs payments.v1.PaymentService declares, one method each. */
@GrpcService
public class PaymentGrpcService extends PaymentServiceGrpc.PaymentServiceImplBase {

    private final AuthorizePayment authorizePayment;
    private final CapturePayment capturePayment;
    private final GetPayment getPayment;

    public PaymentGrpcService(AuthorizePayment authorizePayment, CapturePayment capturePayment, GetPayment getPayment) {
        this.authorizePayment = authorizePayment;
        this.capturePayment = capturePayment;
        this.getPayment = getPayment;
    }

    /** Reserves the money for an order. */
    public void authorize(AuthorizeRequest request, StreamObserver<AuthorizeResponse> observer) {
        var event = authorizePayment.handle(request.getPaymentId(), request.getOrderId(),
                new Money(request.getAmountMinor(), request.getCurrency()));
        observer.onCompleted();
    }

    /** Moves what was reserved. */
    public void capture(CaptureRequest request, StreamObserver<CaptureResponse> observer) {
        capturePayment.handle(request.getPaymentId(), request.getCapturedAt(), request.getAuthCode());
        observer.onCompleted();
    }

    /** Reads one payment. */
    public void getPayment(GetPaymentRequest request, StreamObserver<GetPaymentResponse> observer) {
        getPayment.handle(request.getPaymentId());
        observer.onCompleted();
    }
}
