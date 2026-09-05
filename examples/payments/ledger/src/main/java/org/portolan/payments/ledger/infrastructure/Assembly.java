package org.portolan.payments.ledger.infrastructure;

import java.io.IOException;
import java.time.Clock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.grpc.ManagedChannelBuilder;
import io.nats.client.Nats;
import org.portolan.payments.ledger.application.payment.usecase.AuthorizePayment;
import org.portolan.payments.ledger.application.payment.usecase.CapturePayment;
import org.portolan.payments.ledger.application.payment.usecase.GetPayment;
import org.portolan.payments.ledger.application.payment.usecase.Orders;
import org.portolan.payments.ledger.application.payment.usecase.VoidPayment;
import org.portolan.payments.ledger.application.policy.VoidPaymentOnOrderCancelled;
import org.portolan.payments.ledger.application.refund.usecase.IssueRefund;
import org.portolan.payments.ledger.application.refund.usecase.ListRefunds;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.infrastructure.bus.Bus;
import org.portolan.payments.ledger.infrastructure.bus.LoggingBus;
import org.portolan.payments.ledger.infrastructure.bus.NatsBus;
import org.portolan.payments.ledger.infrastructure.bus.NatsLink;
import org.portolan.payments.ledger.infrastructure.oms.OrderClient;
import org.portolan.payments.ledger.infrastructure.oms.OrderEvents;
import org.portolan.payments.ledger.infrastructure.oms.gen.OrderServiceGrpc;
import org.portolan.payments.ledger.infrastructure.psp.HttpPspClient;
import org.portolan.payments.ledger.infrastructure.psp.PspGateway;
import org.portolan.payments.ledger.infrastructure.psp.PspHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The one place that knows every package exists.
 *
 * The use cases are plain classes - jMolecules' {@code @Service} says what they
 * are in the model, not that a framework should find them - so they are built
 * here, by hand, with the ports they hold. Nothing above this file names a
 * Spring type, and the two domains meet only here and in the policy.
 */
@Configuration
public class Assembly {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /** One writer for everything that leaves as JSON: events on the bus, requests to the gateway. Times are ISO strings, fields camel case, as the estate reads them. */
    @Bean
    ObjectMapper json() {
        return JsonMapper.builder()
                .addModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .build();
    }

    @Bean
    PspHttpClient pspHttpClient(@Value("${ledger.psp-url:http://psp:8080}") String pspUrl) {
        return new HttpPspClient(pspUrl);
    }

    @Bean
    PaymentGateway paymentGateway(PspHttpClient http, ObjectMapper json) {
        return new PspGateway(http, json);
    }

    /** The bus, or none: NATS when a server is named, nothing otherwise. Publisher and subscriber are told the same thing. */
    @Bean
    NatsLink nats(@Value("${ledger.nats-url:}") String natsUrl) throws IOException, InterruptedException {
        return natsUrl.isBlank() ? NatsLink.none() : new NatsLink(Nats.connect(natsUrl));
    }

    /** Both domains' Publisher ports, satisfied by one thing: the domain cannot tell which. */
    @Bean
    Bus bus(NatsLink nats, ObjectMapper json) {
        return nats.connected() ? new NatsBus(nats.connection(), json) : new LoggingBus();
    }

    /** The order service's events, read off the bus and republished in process for the policies (ADR ledger.0002). */
    @Bean
    OrderEvents orderEvents(NatsLink nats, ApplicationEventPublisher inProcess, ObjectMapper json) throws IOException {
        return new OrderEvents(nats, inProcess, json);
    }

    @Bean
    Orders orders(@Value("${ledger.oms-address:oms:9090}") String address) {
        var channel = ManagedChannelBuilder.forTarget(address).usePlaintext().build();
        return new OrderClient(OrderServiceGrpc.newBlockingStub(channel));
    }

    @Bean
    AuthorizePayment authorizePayment(PaymentRepository payments, PaymentGateway gateway, Orders orders, Bus bus, Clock clock) {
        return new AuthorizePayment(payments, gateway, orders, bus, clock);
    }

    @Bean
    CapturePayment capturePayment(PaymentRepository payments, PaymentGateway gateway, Bus bus, Clock clock) {
        return new CapturePayment(payments, gateway, bus, clock);
    }

    @Bean
    VoidPayment voidPayment(PaymentRepository payments, PaymentGateway gateway) {
        return new VoidPayment(payments, gateway);
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

    /** The policy is a bean so its listener is registered; nothing else calls it. */
    @Bean
    VoidPaymentOnOrderCancelled voidPaymentOnOrderCancelled(VoidPayment voidPayment) {
        return new VoidPaymentOnOrderCancelled(voidPayment);
    }
}
