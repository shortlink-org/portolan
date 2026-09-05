package org.portolan.payments.ledger.infrastructure.stripe;

import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.domain.payment.DeclineReason;
import org.portolan.payments.ledger.domain.payment.GatewayUnavailable;
import org.portolan.payments.ledger.domain.payment.Giveback;
import org.portolan.payments.ledger.domain.payment.Hold;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * Stripe, in its own words: a PaymentIntent is created with the capture held
 * back and confirmed, then captured or cancelled, and a Refund is created
 * against it. The translation into the ledger's words - hold, capture, void,
 * refund - lives here and nowhere else.
 *
 * A 2xx is an answer and so is a 402: Stripe took the request and the card
 * said no. Anything else, and not answering at all, is {@link GatewayUnavailable},
 * which is not a decision and records nothing (ADR ledger.0001).
 *
 * Stripe is outside the estate, and stays outside: nobody here provides it. What
 * is vendored beside this file is a narrow copy of Stripe's own OpenAPI
 * document - the four operations below and the shapes they answer with - so the
 * catalog can say which operation each route lands on without pretending the
 * far end is ours (ADR ledger.0003).
 */
@SecondaryAdapter
public class StripeGateway implements PaymentGateway {

    private final StripeHttpClient http;
    private final ObjectMapper json;

    public StripeGateway(StripeHttpClient http, ObjectMapper json) {
        this.http = http;
        this.json = json;
    }

    /** PostPaymentIntents: created and confirmed in one call, with the capture held back until {@link #capture}. */
    @Override
    public Hold hold(String orderId, Money amount) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("amount", Long.toString(amount.amountMinor()));
        form.put("currency", amount.currency().toLowerCase());
        form.put("capture_method", "manual");
        form.put("confirm", "true");
        form.put("metadata[order_id]", orderId);
        var answer = call("hold", () -> http.post("/v1/payment_intents", form));
        if (answer.ok()) {
            JsonNode intent = body(answer.body());
            // Confirmed and waiting for the capture is the only "yes"; anything
            // else Stripe is still asking the customer for is not a hold.
            if ("requires_capture".equals(intent.path("status").asText())) {
                return Hold.held(intent.path("id").asText());
            }
            return Hold.refused(DeclineReason.CARD_REFUSED);
        }
        if (answer.declined()) {
            return Hold.refused(DeclineReason.CARD_REFUSED);
        }
        throw new GatewayUnavailable("hold", "answered " + answer.status());
    }

    /** PostPaymentIntentsIntentCapture: the whole amount that was held. */
    @Override
    public void capture(String authCode) {
        var answer = call("capture", () -> http.post("/v1/payment_intents/" + authCode + "/capture", Map.of()));
        if (!answer.ok()) {
            throw new GatewayUnavailable("capture", "answered " + answer.status());
        }
    }

    /** PostPaymentIntentsIntentCancel: the order was cancelled, so nobody will be charged. */
    @Override
    public void voidHold(String authCode) {
        var answer = call("void", () -> http.post("/v1/payment_intents/" + authCode + "/cancel",
                Map.of("cancellation_reason", "requested_by_customer")));
        if (!answer.ok()) {
            throw new GatewayUnavailable("void", "answered " + answer.status());
        }
    }

    /** PostRefunds: against the intent that was captured, in full or in part. */
    @Override
    public Giveback refund(String authCode, Money amount) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("payment_intent", authCode);
        form.put("amount", Long.toString(amount.amountMinor()));
        var answer = call("refund", () -> http.post("/v1/refunds", form));
        if (answer.ok()) {
            return Giveback.sent(body(answer.body()).path("id").asText());
        }
        if (answer.declined()) {
            return Giveback.refused();
        }
        throw new GatewayUnavailable("refund", "answered " + answer.status());
    }

    private StripeHttpClient.Response call(String operation, java.util.function.Supplier<StripeHttpClient.Response> request) {
        try {
            return request.get();
        } catch (StripeUnavailable silence) {
            throw new GatewayUnavailable(operation, silence);
        }
    }

    /** Stripe answers JSON; an answer that is not is treated as no answer, because nothing in it can be acted on. */
    private JsonNode body(String text) {
        try {
            return json.readTree(text);
        } catch (JsonProcessingException unreadable) {
            throw new GatewayUnavailable("answer", "was not JSON");
        }
    }
}
