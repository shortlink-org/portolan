package org.portolan.payments.ledger.infrastructure;

import java.io.IOException;
import java.time.Clock;

import io.grpc.ManagedChannelBuilder;
import io.nats.client.Connection;
import io.nats.client.Nats;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import org.portolan.payments.ledger.application.payment.usecase.AuthorizePayment;
import org.portolan.payments.ledger.application.payment.usecase.CapturePayment;
import org.portolan.payments.ledger.application.payment.usecase.GetPayment;
import org.portolan.payments.ledger.application.policy.VoidPaymentOnOrderCancelled;
import org.portolan.payments.ledger.application.refund.usecase.IssueRefund;
import org.portolan.payments.ledger.application.refund.usecase.ListRefunds;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.infrastructure.bus.Bus;
import org.portolan.payments.ledger.infrastructure.bus.LoggingBus;
import org.portolan.payments.ledger.infrastructure.bus.NatsBus;
import org.portolan.payments.ledger.infrastructure.oms.OrderClient;
import org.portolan.payments.ledger.infrastructure.oms.gen.OrderServiceGrpc;
import org.portolan.payments.ledger.infrastructure.psp.HttpPspClient;
import org.portolan.payments.ledger.infrastructure.psp.PspGateway;
import org.portolan.payments.ledger.infrastructure.psp.PspHttpClient;

/**
 * The one place that knows every package exists.
 *
 * The use cases are plain classes - jMolecules' {@code @Service} says what they
 * are in the model, not that a framework should find them - so they are built
 * here, by hand, with the ports they hold. Nothing above this file names a
 * Spring type.
 */
@Configuration
public class Assembly {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    PspHttpClient pspHttpClient(@Value("${ledger.psp-url:http://psp:8080}") String pspUrl) {
        return new HttpPspClient(pspUrl);
    }

    @Bean
    PaymentGateway paymentGateway(PspHttpClient http) {
        return new PspGateway(http);
    }

    /** NATS when a server is named, and the log when none is: the domain cannot tell. */
    @Bean
    Bus bus(@Value("${ledger.nats-url:}") String natsUrl) throws IOException, InterruptedException {
        if (natsUrl.isBlank()) {
            return new LoggingBus();
        }
        Connection connection = Nats.connect(natsUrl);
        return new NatsBus(connection);
    }

    @Bean
    OrderClient orderClient(@Value("${ledger.oms-address:oms:9090}") String address) {
        var channel = ManagedChannelBuilder.forTarget(address).usePlaintext().build();
        return new OrderClient(OrderServiceGrpc.newBlockingStub(channel));
    }

    @Bean
    AuthorizePayment authorizePayment(PaymentRepository payments, PaymentGateway gateway, OrderClient orders, Bus bus, Clock clock) {
        return new AuthorizePayment(payments, gateway, orders, bus, clock);
    }

    @Bean
    CapturePayment capturePayment(PaymentRepository payments, PaymentGateway gateway, Bus bus, Clock clock) {
        return new CapturePayment(payments, gateway, bus, clock);
    }

    @Bean
    GetPayment getPayment(PaymentRepository payments) {
        return new GetPayment(payments);
    }

    @Bean
    IssueRefund issueRefund(RefundRepository refunds, PaymentRepository payments, PaymentGateway gateway, Bus bus, Clock clock) {
        return new IssueRefund(refunds, payments, gateway, bus, clock);
    }

    @Bean
    ListRefunds listRefunds(RefundRepository refunds) {
        return new ListRefunds(refunds);
    }

    /** The policy is a bean so the module listener is registered; nothing else calls it. */
    @Bean
    VoidPaymentOnOrderCancelled voidPaymentOnOrderCancelled(PaymentRepository payments, PaymentGateway gateway) {
        return new VoidPaymentOnOrderCancelled(payments, gateway);
    }
}
