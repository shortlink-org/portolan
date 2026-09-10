package org.portolan.payments.ledger.infrastructure.bus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.vo.Money;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CheckoutContractTest {
    @Test
    void authorizationMatchesThePublicFactConsumedByOms() throws Exception {
        var json = JsonMapper.builder().addModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
        var event = new PaymentAuthorized("basket-1", "basket-1", new Money(900, "EUR"), Instant.parse("2026-09-05T12:00:01Z"));
        var expected = Files.readString(Path.of("../../scenarios/fixtures/payment-authorized.json"));
        assertEquals("ledger.PaymentAuthorized", Wire.name(event));
        assertEquals("payments.ledger.payment", Wire.channel(event));
        assertEquals(json.readTree(expected), json.readTree(json.writeValueAsBytes(event)));
    }
}
