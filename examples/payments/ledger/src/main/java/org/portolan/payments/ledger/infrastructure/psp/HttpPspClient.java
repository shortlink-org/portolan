package org.portolan.payments.ledger.infrastructure.psp;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** The gateway's HTTP, and the timeouts a third party gets rather than ours. */
public class HttpPspClient implements PspHttpClient {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private final String baseUrl;

    public HttpPspClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    @Override
    public Response post(String path, String body) {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path))
                .header("content-type", "application/json")
                .timeout(Duration.ofSeconds(5))
                .POST(HttpRequest.BodyPublishers.ofString(body)));
    }

    @Override
    public Response delete(String path) {
        return send(HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(5)).DELETE());
    }

    private Response send(HttpRequest.Builder request) {
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), response.body());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new PspUnavailable("interrupted while waiting for the gateway", interrupted);
        } catch (IOException failure) {
            throw new PspUnavailable("the gateway did not answer", failure);
        }
    }
}
