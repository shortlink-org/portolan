package org.portolan.payments.ledger.infrastructure.bus;

import java.io.IOException;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.JetStreamApiException;
import io.nats.client.impl.Headers;
import io.nats.client.impl.NatsMessage;

/**
 * Events out, over NATS JetStream.
 *
 * The subject is the channel the event names, the payload is the event as
 * JSON with camel-case fields, and its wire name rides in the `event_name`
 * header - the same bargain the other services on this bus made, so a
 * subscriber dispatches without parsing the payload and reads the fields it
 * knows by name. A message id in the headers lets the stream drop a repeat
 * within its window; at least once, stored once.
 */
public class NatsBus implements Bus {

    /** The header the estate reads an event's name from. */
    public static final String EVENT_NAME = "event_name";

    private final Connection nats;
    private final ObjectMapper json;

    public NatsBus(Connection nats, ObjectMapper json) {
        this.nats = nats;
        this.json = json;
    }

    @Override
    public void publish(Object event) {
        String subject = Wire.channel(event);
        Headers headers = new Headers();
        headers.add(EVENT_NAME, Wire.name(event));
        headers.add("Nats-Msg-Id", UUID.randomUUID().toString());
        try {
            Streams.ensure(nats, subject);
            nats.jetStream().publish(NatsMessage.builder()
                    .subject(subject)
                    .headers(headers)
                    .data(json.writeValueAsBytes(event))
                    .build());
        } catch (JsonProcessingException unwritable) {
            throw new IllegalStateException(Wire.name(event) + " could not be written as JSON", unwritable);
        } catch (IOException | JetStreamApiException failure) {
            throw new IllegalStateException(Wire.name(event) + " did not leave: " + failure.getMessage(), failure);
        }
    }
}
