package org.portolan.payments.ledger.infrastructure.stripe;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.StringJoiner;

/** Stripe's HTTP: a bearer secret, form-encoded bodies, and the timeouts a third party gets rather than ours. */
public class HttpStripeClient implements StripeHttpClient {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final String baseUrl;
    private final String secretKey;

    public HttpStripeClient(String baseUrl, String secretKey) {
        this.baseUrl = baseUrl;
        this.secretKey = secretKey;
    }

    @Override
    public Response post(String path, Map<String, String> form) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("authorization", "Bearer " + secretKey)
                .header("content-type", "application/x-www-form-urlencoded")
                .timeout(Duration.ofSeconds(5))
                .POST(HttpRequest.BodyPublishers.ofString(encode(form)))
                .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new StripeUnavailable("interrupted while waiting for Stripe", interrupted);
        } catch (IOException failure) {
            throw new StripeUnavailable("Stripe did not answer", failure);
        }
    }

    private static String encode(Map<String, String> form) {
        StringJoiner body = new StringJoiner("&");
        form.forEach((key, value) -> body.add(
                URLEncoder.encode(key, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8)));
        return body.toString();
    }
}
