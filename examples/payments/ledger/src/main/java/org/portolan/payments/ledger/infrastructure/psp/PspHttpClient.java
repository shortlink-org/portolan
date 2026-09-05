package org.portolan.payments.ledger.infrastructure.psp;

/**
 * The HTTP the gateway is spoken to with. Nothing above infrastructure sees it.
 *
 * An answer is a status and a body, whatever the status; not getting one at
 * all is {@link PspUnavailable}. The two are different facts and the caller
 * is not left to tell them apart from an empty string.
 */
public interface PspHttpClient {

    record Response(int status, String body) {

        public boolean ok() {
            return status / 100 == 2;
        }

        public boolean refused() {
            return status / 100 == 4;
        }
    }

    Response post(String path, String body);

    Response delete(String path);
}
