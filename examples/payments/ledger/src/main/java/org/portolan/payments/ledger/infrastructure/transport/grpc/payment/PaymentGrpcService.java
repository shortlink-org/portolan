package org.portolan.payments.ledger.infrastructure.transport.grpc.payment;

import io.grpc.stub.StreamObserver;
import net.devh.boot.grpc.server.service.GrpcService;
import org.portolan.payments.ledger.application.payment.usecase.AuthorizePayment;
import org.portolan.payments.ledger.application.payment.usecase.CapturePayment;
import org.portolan.payments.ledger.application.payment.usecase.GetPayment;
import org.portolan.payments.ledger.domain.payment.NoSuchPayment;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.infrastructure.transport.grpc.Statuses;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.AuthorizeRequest;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.AuthorizeResponse;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.CaptureRequest;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.CaptureResponse;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.GetPaymentRequest;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.GetPaymentResponse;
import org.portolan.payments.ledger.infrastructure.transport.grpc.payment.gen.PaymentServiceGrpc;

/** The way in: one method per rpc of payments.v1.PaymentService, each running one use case and mapping its refusal to a status. */
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

    /** Asks the gateway to hold the money for an order. The authorisation code is not on the answer; it never leaves the service. */
    @Override
    public void authorize(AuthorizeRequest request, StreamObserver<AuthorizeResponse> observer) {
        try {
            var out = authorizePayment.handle(
                    request.getPaymentId(),
                    request.getOrderId(),
                    new Money(request.getAmountMinor(), request.getCurrency()));
            observer.onNext(AuthorizeResponse.newBuilder()
                    .setPaymentId(out.paymentId())
                    .setAuthorized(out.authorized())
                    .setReason(out.reason() == null ? "" : out.reason().name())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException failure) {
            observer.onError(Statuses.of(failure));
        }
    }

    /** Moves what the gateway was holding. */
    @Override
    public void capture(CaptureRequest request, StreamObserver<CaptureResponse> observer) {
        try {
            var out = capturePayment.handle(request.getPaymentId());
            observer.onNext(CaptureResponse.newBuilder()
                    .setPaymentId(out.paymentId())
                    .setCapturedAt(out.capturedAt().toString())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException failure) {
            observer.onError(Statuses.of(failure));
        }
    }

    /** What happened to the money for one payment. */
    @Override
    public void getPayment(GetPaymentRequest request, StreamObserver<GetPaymentResponse> observer) {
        try {
            var payment = getPayment.handle(request.getPaymentId()).orElseThrow(() -> new NoSuchPayment(request.getPaymentId()));
            observer.onNext(GetPaymentResponse.newBuilder()
                    .setPaymentId(payment.paymentId())
                    .setOrderId(payment.orderId())
                    .setStatus(payment.status().name())
                    .setAmountMinor(payment.amount().amountMinor())
                    .setCurrency(payment.amount().currency())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException failure) {
            observer.onError(Statuses.of(failure));
        }
    }
}
