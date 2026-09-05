package org.portolan.payments.ledger.infrastructure.psp;

import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.domain.payment.DeclineReason;
import org.portolan.payments.ledger.domain.payment.GatewayUnavailable;
import org.portolan.payments.ledger.domain.payment.Giveback;
import org.portolan.payments.ledger.domain.payment.Hold;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The card network, over its own HTTP API, in its own words: a charge is
 * reserved, captured, deleted, refunded. The translation into the ledger's
 * words - hold, capture, void, refund - lives here and nowhere else.
 *
 * A 2xx is an answer and so is a 4xx: the network took the request and said
 * no. Anything else, and not answering at all, is {@link GatewayUnavailable},
 * which is not a decision and records nothing (ADR ledger.0001).
 *
 * No contract is vendored beside this file and no service in the estate
 * provides one: the far end is a third party. So every call through here is
 * recorded and left unresolved, which is the honest answer to "who answers
 * this" rather than a peer invented to make the arrow land somewhere.
 */
@SecondaryAdapter
public class PspGateway implements PaymentGateway {

    private final PspHttpClient http;
    private final ObjectMapper json;

    public PspGateway(PspHttpClient http, ObjectMapper json) {
        this.http = http;
        this.json = json;
    }

    @Override
    public Hold hold(String orderId, Money amount) {
        var answer = call("hold", () -> http.post("/v2/charges", body(Map.of(
                "order", orderId,
                "amount", amount.amountMinor(),
                "currency", amount.currency()))));
        if (answer.ok()) {
            return Hold.held(answer.body());
        }
        if (answer.refused()) {
            return Hold.refused(DeclineReason.CARD_REFUSED);
        }
        throw new GatewayUnavailable("hold", "answered " + answer.status());
    }

    @Override
    public void capture(String authCode) {
        var answer = call("capture", () -> http.post("/v2/charges/" + authCode + "/capture", "{}"));
        if (!answer.ok()) {
            throw new GatewayUnavailable("capture", "answered " + answer.status());
        }
    }

    @Override
    public void voidHold(String authCode) {
        var answer = call("void", () -> http.delete("/v2/charges/" + authCode));
        if (!answer.ok()) {
            throw new GatewayUnavailable("void", "answered " + answer.status());
        }
    }

    @Override
    public Giveback refund(String authCode, Money amount) {
        var answer = call("refund", () -> http.post("/v2/charges/" + authCode + "/refunds", body(Map.of("amount", amount.amountMinor()))));
        if (answer.ok()) {
            return Giveback.sent(answer.body());
        }
        if (answer.refused()) {
            return Giveback.refused();
        }
        throw new GatewayUnavailable("refund", "answered " + answer.status());
    }

    private PspHttpClient.Response call(String operation, java.util.function.Supplier<PspHttpClient.Response> request) {
        try {
            return request.get();
        } catch (PspUnavailable silence) {
            throw new GatewayUnavailable(operation, silence);
        }
    }

    /** The body as JSON, written by a writer rather than glued from strings, so an id with a quote in it is still an id. */
    private String body(Map<String, Object> fields) {
        try {
            return json.writeValueAsString(fields);
        } catch (JsonProcessingException unwritable) {
            throw new IllegalStateException("gateway request could not be written as JSON", unwritable);
        }
    }
}
