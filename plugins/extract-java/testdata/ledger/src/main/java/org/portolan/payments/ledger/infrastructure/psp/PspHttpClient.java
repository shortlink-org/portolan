package org.portolan.payments.ledger.infrastructure.psp;

/** Whatever HTTP client the gateway is spoken to with. */
public interface PspHttpClient {

    String post(String path, String orderId, long amountMinor, String currency);
}
