package org.portolan.payments.ledger.infrastructure.bus;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** The bus when no NATS_URL names a server: the event is written down and nothing leaves. */
public class LoggingBus implements Bus {

    private static final Logger LOG = LoggerFactory.getLogger(LoggingBus.class);

    @Override
    public void publish(Object event) {
        LOG.info("published {}", event);
    }
}
