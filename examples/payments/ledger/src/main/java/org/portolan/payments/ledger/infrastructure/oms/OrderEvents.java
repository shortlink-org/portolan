package org.portolan.payments.ledger.infrastructure.oms;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Dispatcher;
import io.nats.client.JetStreamApiException;
import io.nats.client.Message;
import io.nats.client.PushSubscribeOptions;
import io.nats.client.api.AckPolicy;
import io.nats.client.api.ConsumerConfiguration;
import org.portolan.payments.ledger.application.oms.OrderCancelled;
import org.portolan.payments.ledger.infrastructure.bus.NatsBus;
import org.portolan.payments.ledger.infrastructure.bus.NatsLink;
import org.portolan.payments.ledger.infrastructure.bus.Streams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;

/**
 * The order service's events, read off the bus and handed to the policies in
 * process (ADR ledger.0002).
 *
 * A durable consumer on the order service's stream, filtered on its subject,
 * so a ledger that was down reads what it missed. Each message is
 * acknowledged once the listeners have run and left alone when they threw, so
 * the stream delivers it again: at least once, and the use case behind the
 * policy is idempotent for that reason. An event this service does not know
 * is acknowledged and passed over; it is not broken, just not ours to read.
 */
public class OrderEvents {

    private static final Logger LOG = LoggerFactory.getLogger(OrderEvents.class);

    /** The subject the order service writes its events on. */
    public static final String SUBJECT = "shop.oms.order";

    private final ApplicationEventPublisher inProcess;
    private final ObjectMapper json;

    public OrderEvents(NatsLink nats, ApplicationEventPublisher inProcess, ObjectMapper json) throws IOException {
        this.inProcess = inProcess;
        this.json = json;
        if (!nats.connected()) {
            LOG.info("no bus configured; the order service's events will not be read");
            return;
        }
        subscribe(nats);
    }

    private void subscribe(NatsLink nats) throws IOException {
        Streams.ensure(nats.connection(), SUBJECT);
        Dispatcher dispatcher = nats.connection().createDispatcher();
        var options = PushSubscribeOptions.builder()
                .stream(Streams.nameOf(SUBJECT))
                .durable("ledger-" + OrderCancelled.NAME.replace('.', '-'))
                .configuration(ConsumerConfiguration.builder()
                        .filterSubject(SUBJECT)
                        .ackPolicy(AckPolicy.Explicit)
                        .build())
                .build();
        try {
            nats.connection().jetStream().subscribe(SUBJECT, dispatcher, this::on, false, options);
        } catch (JetStreamApiException failure) {
            throw new IOException("subscribing to " + SUBJECT + ": " + failure.getMessage(), failure);
        }
    }

    private void on(Message message) {
        String name = message.getHeaders() == null ? "" : message.getHeaders().getFirst(NatsBus.EVENT_NAME);
        if (!OrderCancelled.NAME.equals(name)) {
            message.ack();
            return;
        }
        try {
            JsonNode payload = json.readTree(new String(message.getData(), StandardCharsets.UTF_8));
            inProcess.publishEvent(new OrderCancelled(payload.path("orderId").asText(), payload.path("reason").asText()));
            message.ack();
        } catch (RuntimeException | IOException failure) {
            LOG.warn("{} was not handled and will be delivered again: {}", name, failure.getMessage());
            message.nak();
        }
    }
}
