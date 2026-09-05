package org.portolan.payments.ledger.infrastructure.bus;

import java.io.IOException;
import java.time.Duration;

import io.nats.client.Connection;
import io.nats.client.JetStreamApiException;
import io.nats.client.api.StreamConfiguration;

/**
 * The stream a subject belongs to, declared the same way by every service on
 * this bus: one per service, named for the first two segments of its subjects
 * - `payments-ledger` over `payments.ledger.>`, `shop-oms` over the order
 * service's. Both ends declare it, so whichever comes up first makes it.
 */
public final class Streams {

    /** How long a stream remembers a message id: long enough for any retry. */
    private static final Duration DUPLICATE_WINDOW = Duration.ofHours(2);

    private Streams() {}

    /** `shop.oms.order` -> `shop-oms`. */
    public static String nameOf(String subject) {
        String[] parts = subject.split("\\.");
        return parts.length >= 2 ? parts[0] + "-" + parts[1] : subject;
    }

    /** `shop.oms.order` -> `shop.oms.>`. */
    public static String subjectsOf(String subject) {
        String[] parts = subject.split("\\.");
        return parts.length >= 2 ? parts[0] + "." + parts[1] + ".>" : subject;
    }

    public static void ensure(Connection nats, String subject) throws IOException {
        try {
            var management = nats.jetStreamManagement();
            String name = nameOf(subject);
            if (management.getStreamNames().contains(name)) {
                return;
            }
            management.addStream(StreamConfiguration.builder()
                    .name(name)
                    .subjects(subjectsOf(subject))
                    .duplicateWindow(DUPLICATE_WINDOW)
                    .build());
        } catch (JetStreamApiException failure) {
            throw new IOException("stream for " + subject + ": " + failure.getMessage(), failure);
        }
    }
}
